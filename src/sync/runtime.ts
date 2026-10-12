import { liveQuery } from 'dexie'
import { deleteDb, openDb, type BibleNoteDb } from '@/lib/db'
import type { StorageProvider } from '@/lib/storage/StorageProvider'
import { createSupabaseStorageProvider } from '@/lib/storage/SupabaseStorageProvider'
import { supabase, supabaseEndpoint } from '@/lib/supabase'
import { SyncEngine } from './engine'
import { createRealtimeHub } from './realtime'
import { createStore, type Store } from './store'
import { createSupabaseApi } from './supabaseApi'
import type { SyncNotice } from './types'

const PULL_INTERVAL_MS = 60_000
const PRESENCE_INTERVAL_MS = 10 * 60_000

export interface Notice {
  id: number
  notice: SyncNotice
}

export interface SyncRuntime {
  db: BibleNoteDb
  engine: SyncEngine
  /** File contents: signed URLs to read, storage usage. Uploads go through the engine. */
  storage: StorageProvider
  userId: string
  notices: Store<Notice[]>
  /** Shows a notice from the UI (e.g. the editor saved the text as a conflict copy). */
  notify(notice: SyncNotice): void
  dismissNotice(id: number): void
  start(accessToken: string | null): void
  stop(): void
  /**
   * Explicit sign-out on this device: ends the session locally, then stops sync and wipes the
   * data. Resolves false (and changes nothing) when the session could not be ended, e.g. offline.
   */
  signOutAndWipe(): Promise<boolean>
}

/**
 * Browser wiring around the engine: Dexie database, timers, online/visibility events,
 * Realtime channels. Created once per signed-in account by SyncProvider.
 */
export function createSyncRuntime(userId: string): SyncRuntime {
  const db = openDb(userId)
  const storage = createSupabaseStorageProvider(supabase, supabaseEndpoint)
  const api = createSupabaseApi(supabase, storage)
  const notices = createStore<Notice[]>([])
  let nextNoticeId = 1
  const cleanups: Array<() => void> = []

  const notify = (notice: SyncNotice) =>
    notices.set([...notices.get(), { id: nextNoticeId++, notice }])
  const hub = createRealtimeHub(supabase, userId, () => engine.requestPull())
  const engine = new SyncEngine({
    db,
    api,
    userId,
    onNotice: notify,
    onPushed: (spaceIds) => hub.broadcast(spaceIds),
    isOnline: () => navigator.onLine,
  })

  return {
    db,
    engine,
    storage,
    userId,
    notices,
    notify,
    dismissNotice(id) {
      notices.set(notices.get().filter((n) => n.id !== id))
    },

    start(accessToken) {
      hub.setAuth(accessToken)
      void navigator.storage?.persist?.()

      const onOnline = () => engine.connectionRestored()
      const onOffline = () => engine.setOnline(false)
      const onVisible = () => {
        const visible = document.visibilityState === 'visible'
        engine.setVisible(visible)
        if (visible) {
          engine.requestPull()
          engine.requestPush(0)
        }
      }
      engine.setVisible(document.visibilityState === 'visible')
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      cleanups.push(() => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
        document.removeEventListener('visibilitychange', onVisible)
      })

      const pullTimer = setInterval(() => {
        if (document.visibilityState === 'visible') engine.requestPull()
      }, PULL_INTERVAL_MS)
      const presence = () => api.touchPresence().catch(() => undefined)
      void presence()
      const presenceTimer = setInterval(() => void presence(), PRESENCE_INTERVAL_MS)
      cleanups.push(() => {
        clearInterval(pullTimer)
        clearInterval(presenceTimer)
      })

      // Realtime needs the current user token, also after refreshes. A null session while
      // signed in offline keeps the last token. When the session is (re)confirmed by the
      // server, sync resumes at once, without waiting for a timer or a user action.
      const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
        if (!session) return
        hub.setAuth(session.access_token)
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          engine.setOnline(true)
        }
      })
      cleanups.push(() => auth.subscription.unsubscribe())

      // One channel per accessible space, kept in step with my_spaces() results.
      const access = liveQuery(() => db.spaceAccess.toArray()).subscribe({
        next: (rows) => hub.sync(rows.map((r) => r.space_id)),
        error: () => undefined,
      })
      cleanups.push(() => access.unsubscribe())

      engine.setOnline(navigator.onLine)
    },

    stop() {
      for (const cleanup of cleanups.splice(0)) cleanup()
      hub.stop()
      engine.dispose()
    },

    async signOutAndWipe() {
      // auth-js keeps the session when the request fails for lack of network: never wipe the
      // data of a session that is still active.
      if (!navigator.onLine) return false
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) return false
      this.stop()
      db.close({ disableAutoOpen: true })
      await deleteDb(userId)
      return true
    },
  }
}

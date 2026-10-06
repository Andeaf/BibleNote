import { liveQuery } from 'dexie'
import { deleteDb, openDb, type BibleNoteDb } from '@/lib/db'
import { supabase } from '@/lib/supabase'
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
  userId: string
  notices: Store<Notice[]>
  dismissNotice(id: number): void
  start(accessToken: string | null): void
  stop(): void
  /** Explicit sign-out on this device: stops sync, ends the session locally, wipes the data. */
  signOutAndWipe(): Promise<void>
}

/**
 * Browser wiring around the engine: Dexie database, timers, online/visibility events,
 * Realtime channels. Created once per signed-in account by SyncProvider.
 */
export function createSyncRuntime(userId: string): SyncRuntime {
  const db = openDb(userId)
  const api = createSupabaseApi(supabase)
  const notices = createStore<Notice[]>([])
  let nextNoticeId = 1
  const cleanups: Array<() => void> = []

  const hub = createRealtimeHub(supabase, userId, () => engine.requestPull())
  const engine = new SyncEngine({
    db,
    api,
    userId,
    onNotice: (notice) => notices.set([...notices.get(), { id: nextNoticeId++, notice }]),
    onPushed: (spaceIds) => hub.broadcast(spaceIds),
  })

  return {
    db,
    engine,
    userId,
    notices,
    dismissNotice(id) {
      notices.set(notices.get().filter((n) => n.id !== id))
    },

    start(accessToken) {
      hub.setAuth(accessToken)
      void navigator.storage?.persist?.()

      const onOnline = () => engine.setOnline(true)
      const onOffline = () => engine.setOnline(false)
      const onVisible = () => {
        if (document.visibilityState === 'visible') {
          engine.requestPull()
          engine.requestPush(0)
        }
      }
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

      // Realtime needs the current user token, also after refreshes.
      const { data: auth } = supabase.auth.onAuthStateChange((_event, session) => {
        hub.setAuth(session?.access_token ?? null)
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
      this.stop()
      db.close()
      await supabase.auth.signOut({ scope: 'local' })
      await deleteDb(userId)
    },
  }
}

import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { pathTo } from '@/data/tree'
import { readGuestName } from '@/features/share/guestName'
import { t } from '@/i18n/ro'
import type { NoteRow } from '@/lib/database.types'
import { useDb, useSyncRuntime } from '@/sync/SyncContext'

/** `undefined` while loading, `null` when the note is not on this device. */
export function useNote(noteId: string): NoteRow | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => (await db.notes.get(noteId)) ?? null, [db, noteId])
}

/** Every note row of a space, trashed ones included (lists filter as needed). */
export function useSpaceNotes(spaceId: string): NoteRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.notes.where('space_id').equals(spaceId).toArray(), [db, spaceId])
}

/**
 * Live notes the account can reach: not in the trash, in a main folder that is not in the trash
 * either. Search and the tags screens read this.
 */
export function useAllNotes(): NoteRow[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [notes, spaces, access] = await Promise.all([
      db.notes.toArray(),
      db.spaces.toArray(),
      db.spaceAccess.toArray(),
    ])
    const reachable = new Set(access.map((a) => a.space_id))
    const live = new Set(
      spaces.filter((s) => !s.deleted_at && reachable.has(s.id)).map((s) => s.id),
    )
    return notes.filter((n) => !n.deleted_at && !n.purged_at && live.has(n.space_id))
  }, [db])
}

export type NoteSyncState = 'failed' | 'pending' | 'synced'

/** Whether this note still has changes waiting in the outbox, or one that failed. */
export function useNoteSyncState(noteId: string): NoteSyncState {
  const db = useDb()
  return (
    useLiveQuery(async () => {
      const entries = await db.outbox.where('[table+row_id]').equals(['notes', noteId]).toArray()
      if (entries.some((e) => e.status === 'failed')) return 'failed'
      return entries.length > 0 ? 'pending' : 'synced'
    }, [db, noteId]) ?? 'synced'
  )
}

/** "tine", the person's name in this space, or "altcineva". */
export function useAuthorName(userId: string | null, spaceId: string): string {
  const { db, userId: me } = useSyncRuntime()
  const name = useLiveQuery(async () => {
    if (!userId || userId === me) return null
    const member = await db.members
      .where('space_id')
      .equals(spaceId)
      .filter((m) => m.user_id === userId)
      .first()
    return member?.display_name ?? (await db.profiles.get(userId))?.display_name ?? null
  }, [db, userId, spaceId, me])
  if (userId === me) return t.notes.you
  return name?.trim() || t.notes.someone
}

/**
 * The name this user shows to the others in a space: their member name there, their profile
 * name, the account name, or "altcineva".
 */
export function useMyName(spaceId: string): string {
  const { db, userId } = useSyncRuntime()
  const { session } = useAuth()
  const stored = useLiveQuery(async () => {
    const member = await db.members
      .where('space_id')
      .equals(spaceId)
      .filter((m) => m.user_id === userId)
      .first()
    return member?.display_name ?? (await db.profiles.get(userId))?.display_name ?? null
  }, [db, spaceId, userId])
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string }
  return (
    stored?.trim() ||
    meta.full_name ||
    meta.name ||
    readGuestName() ||
    session?.user.email?.split('@')[0] ||
    t.notes.someone
  )
}

/** "Folder principal › Subfolder" for any note the account can reach (search and tag lists). */
export function useLocator(): (note: Pick<NoteRow, 'space_id' | 'folder_id'>) => string {
  const db = useDb()
  const data = useLiveQuery(
    async () => ({ spaces: await db.spaces.toArray(), folders: await db.folders.toArray() }),
    [db],
  )
  return useMemo(() => {
    const spaces = new Map((data?.spaces ?? []).map((s) => [s.id, s.name]))
    const folders = data?.folders ?? []
    return (note) =>
      [spaces.get(note.space_id) ?? '', ...pathTo(folders, note.folder_id).map((f) => f.name)]
        .filter(Boolean)
        .join(' › ')
  }, [data])
}

/** The current time, refreshed every minute (for "acum 5 minute"). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

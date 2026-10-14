import type { Json, ProfileRow } from '@/lib/database.types'
import type { Appearance } from '@/lib/appearance'
import type { BibleNoteDb } from '@/lib/db'
import { nowIso } from '@/lib/ids'
import { enqueue } from '@/sync/outbox'

/**
 * Saves part of the account's settings (theme, text size): the own profile row and one outbox
 * entry with the whole settings object (unknown keys kept), so the last change wins on the
 * server as on every device. Works offline.
 */
export async function saveSettings(
  db: BibleNoteDb,
  userId: string,
  patch: Partial<Appearance>,
): Promise<void> {
  await db.transaction('rw', [db.profiles, db.outbox], async () => {
    const row = await db.profiles.get(userId)
    const current = row?.settings
    const base =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, Json>)
        : {}
    const settings = { ...base, ...patch } as Json
    if (row) await db.profiles.update(userId, { settings })
    else {
      // Not pulled yet: a stand-in until the server's row arrives with the push's answer.
      const now = nowIso()
      const profile: ProfileRow = {
        id: userId,
        display_name: null,
        settings,
        created_at: now,
        updated_at: now,
      }
      await db.profiles.put(profile)
    }
    await enqueue(db, {
      table: 'profiles',
      row_id: userId,
      space_id: '',
      op: 'update',
      payload: { settings },
    })
  })
}

import type { SpaceRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { newId, nowIso } from '@/lib/ids'
import { enqueue } from '@/sync/outbox'

export interface SpaceInput {
  name: string
  color: string | null
  emoji: string | null
}

/**
 * Main folders. Every function writes Dexie and the outbox in one transaction; the caller
 * then asks the engine to push. Access rules are enforced by the server; the UI only hides
 * actions the role does not allow.
 */
export async function createSpace(
  db: BibleNoteDb,
  ownerId: string,
  input: SpaceInput,
): Promise<SpaceRow> {
  const now = nowIso()
  const row: SpaceRow = {
    id: newId(),
    owner_id: ownerId,
    name: input.name.trim(),
    color: input.color,
    emoji: input.emoji,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purged_at: null,
  }
  await db.transaction('rw', [db.spaces, db.spaceAccess, db.outbox], async () => {
    await db.spaces.put(row)
    await db.spaceAccess.put({ space_id: row.id, role: 'owner' })
    await enqueue(db, {
      table: 'spaces',
      row_id: row.id,
      space_id: row.id,
      op: 'insert',
      payload: {
        id: row.id,
        owner_id: row.owner_id,
        name: row.name,
        color: row.color,
        emoji: row.emoji,
      },
    })
  })
  return row
}

export async function updateSpace(
  db: BibleNoteDb,
  spaceId: string,
  patch: Partial<Pick<SpaceRow, 'name' | 'color' | 'emoji' | 'deleted_at'>>,
): Promise<void> {
  const changes = { ...patch, updated_at: nowIso() }
  if (typeof changes.name === 'string') changes.name = changes.name.trim()
  await db.transaction('rw', [db.spaces, db.outbox], async () => {
    await db.spaces.update(spaceId, changes)
    const { updated_at: _ignored, ...payload } = changes
    void _ignored
    await enqueue(db, {
      table: 'spaces',
      row_id: spaceId,
      space_id: spaceId,
      op: 'update',
      payload,
    })
  })
}

/** Owner only. Members lose access at once; the contents follow the space into the trash. */
export async function trashSpace(db: BibleNoteDb, spaceId: string): Promise<void> {
  await updateSpace(db, spaceId, { deleted_at: nowIso() })
}

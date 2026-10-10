import type { FolderRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { newId, nowIso } from '@/lib/ids'
import { enqueue } from '@/sync/outbox'
import { trashNoteRow } from './notes'
import { descendantIds, isSelfOrDescendant } from './tree'

export interface FolderInput {
  name: string
  color: string | null
  emoji: string | null
}

export async function createFolder(
  db: BibleNoteDb,
  userId: string,
  spaceId: string,
  parentId: string | null,
  input: FolderInput,
): Promise<FolderRow> {
  const now = nowIso()
  const row: FolderRow = {
    id: newId(),
    space_id: spaceId,
    parent_id: parentId,
    name: input.name.trim(),
    color: input.color,
    emoji: input.emoji,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purged_at: null,
  }
  await db.transaction('rw', [db.folders, db.outbox], async () => {
    await db.folders.put(row)
    await enqueue(db, {
      table: 'folders',
      row_id: row.id,
      space_id: spaceId,
      op: 'insert',
      payload: {
        id: row.id,
        space_id: row.space_id,
        parent_id: row.parent_id,
        name: row.name,
        color: row.color,
        emoji: row.emoji,
        created_by: row.created_by,
        updated_by: row.updated_by,
      },
    })
  })
  return row
}

export async function updateFolder(
  db: BibleNoteDb,
  userId: string,
  folderId: string,
  patch: Partial<Pick<FolderRow, 'name' | 'color' | 'emoji'>>,
): Promise<void> {
  const changes = { ...patch, updated_by: userId }
  if (typeof changes.name === 'string') changes.name = changes.name.trim()
  await db.transaction('rw', [db.folders, db.outbox], async () => {
    const folder = await db.folders.get(folderId)
    if (!folder) return
    await db.folders.update(folderId, { ...changes, updated_at: nowIso() })
    await enqueue(db, {
      table: 'folders',
      row_id: folderId,
      space_id: folder.space_id,
      op: 'update',
      payload: changes,
    })
  })
}

/** Moves a folder under another folder of the same space (null = space root). Refuses cycles. */
export async function moveFolder(
  db: BibleNoteDb,
  userId: string,
  folderId: string,
  targetParentId: string | null,
): Promise<boolean> {
  return db.transaction('rw', [db.folders, db.outbox], async () => {
    const folder = await db.folders.get(folderId)
    if (!folder || folder.parent_id === targetParentId) return false
    const siblings = await db.folders.where('space_id').equals(folder.space_id).toArray()
    if (isSelfOrDescendant(siblings, folderId, targetParentId)) return false
    if (targetParentId) {
      const target = siblings.find((f) => f.id === targetParentId)
      if (!target || target.deleted_at) return false
    }
    await db.folders.update(folderId, {
      parent_id: targetParentId,
      updated_by: userId,
      updated_at: nowIso(),
    })
    await enqueue(db, {
      table: 'folders',
      row_id: folderId,
      space_id: folder.space_id,
      op: 'update',
      payload: { parent_id: targetParentId, updated_by: userId },
    })
    return true
  })
}

/**
 * Moves a folder to the trash together with its whole subtree (same timestamp on every row),
 * so restoring the folder later restores exactly what went with it.
 */
export async function trashFolder(
  db: BibleNoteDb,
  userId: string,
  folderId: string,
): Promise<void> {
  const stamp = nowIso()
  await db.transaction('rw', [db.folders, db.notes, db.files, db.outbox], async () => {
    const folder = await db.folders.get(folderId)
    if (!folder) return
    const all = await db.folders.where('space_id').equals(folder.space_id).toArray()
    const folderIds = [folderId, ...descendantIds(all, folderId)]
    for (const id of folderIds) {
      const row = all.find((f) => f.id === id)
      if (!row || row.deleted_at) continue
      await db.folders.update(id, { deleted_at: stamp, updated_by: userId, updated_at: stamp })
      await enqueue(db, {
        table: 'folders',
        row_id: id,
        space_id: folder.space_id,
        op: 'update',
        payload: { deleted_at: stamp, updated_by: userId },
      })
    }
    const notes = await db.notes.where('folder_id').anyOf(folderIds).toArray()
    for (const note of notes) await trashNoteRow(db, note, stamp)
    const files = await db.files.where('folder_id').anyOf(folderIds).toArray()
    for (const file of files) {
      if (file.deleted_at) continue
      await db.files.update(file.id, { deleted_at: stamp, updated_at: stamp })
      await enqueue(db, {
        table: 'files',
        row_id: file.id,
        space_id: folder.space_id,
        op: 'update',
        payload: { deleted_at: stamp },
      })
    }
  })
}

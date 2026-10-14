import { putPendingBlob } from '@/lib/blobs'
import type { FileKind, FileRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { storagePath } from '@/lib/files'
import { newId, nowIso } from '@/lib/ids'
import { INSERT_COLUMNS, pickColumns } from '@/sync/columns'
import { enqueue } from '@/sync/outbox'

export interface NewFile {
  name: string
  kind: FileKind
  mime: string
  blob: Blob
  durationSec: number | null
}

/**
 * Writes a new file row, its content as a pending blob and one `upload` outbox entry. Call
 * inside a transaction on files + blobs + outbox. The engine uploads the object first and
 * inserts the row after it.
 */
export async function writeNewFile(
  db: BibleNoteDb,
  userId: string,
  spaceId: string,
  folderId: string | null,
  input: NewFile,
): Promise<FileRow> {
  const now = nowIso()
  const id = newId()
  const row: FileRow = {
    id,
    space_id: spaceId,
    folder_id: folderId,
    name: input.name.trim() || id,
    kind: input.kind,
    mime: input.mime,
    size_bytes: input.blob.size,
    storage_path: storagePath(spaceId, id),
    duration_sec: input.durationSec,
    created_by: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purged_at: null,
  }
  await db.files.put(row)
  await putPendingBlob(db, id, spaceId, input.blob)
  await enqueue(db, {
    table: 'files',
    row_id: id,
    space_id: spaceId,
    op: 'upload',
    payload: pickColumns(row, INSERT_COLUMNS.files),
  })
  return row
}

/** Queues files for upload (already checked and compressed). Works offline. */
export async function addFiles(
  db: BibleNoteDb,
  userId: string,
  spaceId: string,
  folderId: string | null,
  files: readonly NewFile[],
): Promise<FileRow[]> {
  return db.transaction('rw', [db.files, db.blobs, db.outbox], async () => {
    const rows: FileRow[] = []
    for (const file of files) rows.push(await writeNewFile(db, userId, spaceId, folderId, file))
    return rows
  })
}

async function updateFile(
  db: BibleNoteDb,
  fileId: string,
  patch: Partial<Pick<FileRow, 'name' | 'folder_id' | 'deleted_at'>>,
): Promise<boolean> {
  return db.transaction('rw', [db.files, db.outbox], async () => {
    const file = await db.files.get(fileId)
    if (!file) return false
    await db.files.update(fileId, { ...patch, updated_at: nowIso() })
    await enqueue(db, {
      table: 'files',
      row_id: fileId,
      space_id: file.space_id,
      op: 'update',
      payload: patch,
    })
    return true
  })
}

export async function renameFile(db: BibleNoteDb, fileId: string, name: string): Promise<boolean> {
  const trimmed = name.trim()
  if (!trimmed) return false
  return updateFile(db, fileId, { name: trimmed })
}

/** Moves a file to another folder of the same space (null = space root). */
export async function moveFile(
  db: BibleNoteDb,
  fileId: string,
  folderId: string | null,
): Promise<boolean> {
  const file = await db.files.get(fileId)
  if (!file || file.folder_id === folderId) return false
  if (folderId) {
    const target = await db.folders.get(folderId)
    if (!target || target.space_id !== file.space_id || target.deleted_at) return false
  }
  return updateFile(db, fileId, { folder_id: folderId })
}

export async function trashFile(db: BibleNoteDb, fileId: string): Promise<boolean> {
  return updateFile(db, fileId, { deleted_at: nowIso() })
}

export async function restoreFile(db: BibleNoteDb, fileId: string): Promise<boolean> {
  return updateFile(db, fileId, { deleted_at: null })
}

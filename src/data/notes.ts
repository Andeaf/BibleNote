import type { Json, NoteRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { newId, nowIso } from '@/lib/ids'
import { SAVE_NOTE_CONTENT_COLUMNS, SAVE_NOTE_CREATE_COLUMNS, pickColumns } from '@/sync/columns'
import {
  conflictCopy,
  conflictKey,
  contentOf,
  localDisplayName,
  sameBody,
  sameContent,
  type NoteContent,
} from '@/sync/conflicts'
import { createsRow, enqueue } from '@/sync/outbox'

/** What Tiptap produces for an empty editor. */
export const EMPTY_DOC: Json = { type: 'doc', content: [{ type: 'paragraph' }] }

export const isEmptyNote = (note: Pick<NoteRow, 'title' | 'content_text' | 'tags'>): boolean =>
  !note.title.trim() && !note.content_text.trim() && note.tags.length === 0

/**
 * A new note lives only on this device until its first change, which queues its create (a
 * save_note without base version, carrying the whole row). An untouched empty note is dropped
 * when the editor closes (discardIfEmpty), so "Notiță nouă" followed by "Înapoi" leaves nothing.
 */
export async function createNote(
  db: BibleNoteDb,
  userId: string,
  spaceId: string,
  folderId: string | null,
): Promise<NoteRow> {
  const now = nowIso()
  const row: NoteRow = {
    id: newId(),
    space_id: spaceId,
    folder_id: folderId,
    title: '',
    content: EMPTY_DOC,
    content_text: '',
    tags: [],
    pinned: false,
    version: 0,
    created_by: userId,
    updated_by: userId,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    purged_at: null,
  }
  await db.notes.put(row)
  return row
}

/** True while the note exists only here: the server never confirmed it and no create is queued. */
async function isLocalOnly(db: BibleNoteDb, note: NoteRow): Promise<boolean> {
  if (note.version > 0) return false
  const entries = await db.outbox.where('[table+row_id]').equals(['notes', note.id]).toArray()
  return !entries.some(createsRow)
}

/**
 * Queues a change of a note (call inside a transaction on notes + outbox, with `note` already
 * changed). The first change of a note that exists only here becomes its create instead.
 * A content save is based on the version this device last got from the server.
 */
async function enqueueNote(
  db: BibleNoteDb,
  note: NoteRow,
  op: 'save_note' | 'update',
  payload: Record<string, unknown>,
): Promise<void> {
  if (await isLocalOnly(db, note)) {
    await enqueue(db, {
      table: 'notes',
      row_id: note.id,
      space_id: note.space_id,
      op: 'save_note',
      base_version: null,
      payload: pickColumns(note, SAVE_NOTE_CREATE_COLUMNS),
    })
    return
  }
  await enqueue(db, {
    table: 'notes',
    row_id: note.id,
    space_id: note.space_id,
    op,
    payload,
    ...(op === 'save_note' ? { base_version: note.version } : {}),
  })
}

async function writeContent(
  db: BibleNoteDb,
  userId: string,
  note: NoteRow,
  next: NoteContent,
): Promise<void> {
  const changes = { ...contentOf(next), updated_by: userId, updated_at: nowIso() }
  await db.notes.update(note.id, changes)
  await enqueueNote(
    db,
    { ...note, ...changes },
    'save_note',
    pickColumns(changes, SAVE_NOTE_CONTENT_COLUMNS),
  )
}

export type SaveOutcome =
  | { status: 'saved'; noteId: string }
  /** The content went to the copy the engine made in a conflict; the editor continues there. */
  | { status: 'moved'; noteId: string }
  /** The content became a new conflict copy (the caller says so); the editor continues there. */
  | { status: 'copied'; noteId: string }
  | { status: 'missing' }

/**
 * Autosave of the editor. `base` is the content the editor's document descends from (what it
 * loaded or last saved); the write only lands on the note while the note still holds `base`.
 * Otherwise the note changed underneath the editor (a pull brought another device's version, or
 * the engine resolved a conflict) and nothing is overwritten: the editor's content goes to the
 * copy the engine made for it, or to a new copy "Titlu (conflict – Nume, dată)".
 */
export async function saveNoteContent(
  db: BibleNoteDb,
  userId: string,
  noteId: string,
  base: NoteContent,
  next: NoteContent,
): Promise<SaveOutcome> {
  return db.transaction(
    'rw',
    [db.notes, db.outbox, db.meta, db.members, db.profiles],
    async (): Promise<SaveOutcome> => {
      const note = await db.notes.get(noteId)
      if (!note || note.purged_at) return { status: 'missing' }
      if (sameContent(note, next)) return { status: 'saved', noteId }
      if (sameContent(note, base)) {
        await writeContent(db, userId, note, next)
        return { status: 'saved', noteId }
      }
      const marker = await db.meta.get(conflictKey(noteId))
      const copy = marker ? await db.notes.get(marker.value) : undefined
      if (copy && !copy.purged_at && sameBody(copy, base)) {
        await db.meta.delete(conflictKey(noteId))
        // The copy carries the "(conflict – …)" title unless the title itself was just edited.
        const title = next.title === base.title ? copy.title : next.title
        await writeContent(db, userId, copy, { ...next, title })
        return { status: 'moved', noteId: copy.id }
      }
      const name = await localDisplayName(db, userId, note.space_id)
      const fresh = conflictCopy({ ...note, ...next }, userId, name, new Date())
      await db.notes.put(fresh)
      await enqueueNote(db, fresh, 'save_note', {})
      return { status: 'copied', noteId: fresh.id }
    },
  )
}

/** Drops a note that never left this device and is still empty (the editor closed on it). */
export async function discardIfEmpty(db: BibleNoteDb, noteId: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.outbox], async () => {
    const note = await db.notes.get(noteId)
    if (note && isEmptyNote(note) && (await isLocalOnly(db, note))) await db.notes.delete(noteId)
  })
}

/** Metadata goes through update_note_meta (a direct UPDATE), never through save_note. */
async function updateMeta(
  db: BibleNoteDb,
  noteId: string,
  patch: Partial<Pick<NoteRow, 'folder_id' | 'pinned' | 'deleted_at'>>,
): Promise<boolean> {
  return db.transaction('rw', [db.notes, db.outbox], async () => {
    const note = await db.notes.get(noteId)
    if (!note) return false
    await db.notes.update(noteId, patch)
    await enqueueNote(db, { ...note, ...patch }, 'update', patch)
    return true
  })
}

export function setNotePinned(db: BibleNoteDb, noteId: string, pinned: boolean): Promise<boolean> {
  return updateMeta(db, noteId, { pinned })
}

/** Moves a note to another folder of the same space (null = space root). */
export async function moveNote(
  db: BibleNoteDb,
  noteId: string,
  folderId: string | null,
): Promise<boolean> {
  const note = await db.notes.get(noteId)
  if (!note || note.folder_id === folderId) return false
  if (folderId) {
    const folder = await db.folders.get(folderId)
    if (!folder || folder.space_id !== note.space_id || folder.deleted_at) return false
  }
  return updateMeta(db, noteId, { folder_id: folderId })
}

/**
 * Puts a note in the trash with `stamp` (call inside a transaction on notes + outbox). A note
 * that never left this device and is still empty is simply dropped.
 */
export async function trashNoteRow(db: BibleNoteDb, note: NoteRow, stamp: string): Promise<void> {
  if (note.deleted_at) return
  if (isEmptyNote(note) && (await isLocalOnly(db, note))) {
    await db.notes.delete(note.id)
    return
  }
  await db.notes.update(note.id, { deleted_at: stamp })
  await enqueueNote(db, { ...note, deleted_at: stamp }, 'update', { deleted_at: stamp })
}

/** Takes a note out of the trash (call inside a transaction on notes + outbox). */
export async function restoreNoteRow(db: BibleNoteDb, note: NoteRow): Promise<void> {
  if (!note.deleted_at) return
  await db.notes.update(note.id, { deleted_at: null })
  await enqueueNote(db, { ...note, deleted_at: null }, 'update', { deleted_at: null })
}

export async function restoreNote(db: BibleNoteDb, noteId: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.outbox], async () => {
    const note = await db.notes.get(noteId)
    if (note) await restoreNoteRow(db, note)
  })
}

export async function trashNote(db: BibleNoteDb, noteId: string): Promise<void> {
  await db.transaction('rw', [db.notes, db.outbox], async () => {
    const note = await db.notes.get(noteId)
    if (note) await trashNoteRow(db, note, nowIso())
  })
}

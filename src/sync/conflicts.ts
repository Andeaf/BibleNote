import { t } from '@/i18n/ro'
import type { NoteRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { newId } from '@/lib/ids'
import { jsonEqual } from '@/lib/jsonEqual'
import { formatDateTime } from '@/lib/time'

/** The parts of a note that save_note writes and compares. */
export type NoteContent = Pick<NoteRow, 'title' | 'content' | 'content_text' | 'tags'>

export const contentOf = (note: NoteContent): NoteContent => ({
  title: note.title,
  content: note.content,
  content_text: note.content_text,
  tags: note.tags,
})

/** What save_note compares for idempotency: title, content and tags (content_text follows content). */
export const sameBody = (a: Pick<NoteContent, 'content' | 'tags'>, b: typeof a): boolean =>
  jsonEqual(a.content, b.content) && jsonEqual(a.tags, b.tags)

export const sameContent = (a: NoteContent, b: NoteContent): boolean =>
  a.title === b.title && sameBody(a, b)

/**
 * Meta key that remembers, for an editor still open on a note, which copy its local variant went
 * to. Written by the engine when it resolves a conflict, read by the data layer's content save.
 */
export const conflictKey = (noteId: string): string => `conflict:${noteId}`

/** "Titlu (conflict – Nume, 4 oct. 2026 14:32)". */
export function conflictTitle(title: string, name: string, at: Date): string {
  return t.notes.conflictTitle(title.trim() || t.notes.untitled, name, formatDateTime(at))
}

/** My name as the others in this space see it: the member name, else my profile name. */
export async function localDisplayName(
  db: BibleNoteDb,
  userId: string,
  spaceId: string,
): Promise<string> {
  const member = await db.members
    .where('space_id')
    .equals(spaceId)
    .filter((m) => m.user_id === userId)
    .first()
  const profile = await db.profiles.get(userId)
  return (member?.display_name ?? profile?.display_name ?? '').trim()
}

/**
 * The local variant of a conflicted note, as a new note in the same folder. It exists only on
 * this device until its create entry (save_note with base_version null) reaches the server.
 */
export function conflictCopy(
  variant: NoteContent & Pick<NoteRow, 'space_id' | 'folder_id'>,
  userId: string,
  name: string,
  at: Date,
): NoteRow {
  const stamp = at.toISOString()
  return {
    id: newId(),
    space_id: variant.space_id,
    folder_id: variant.folder_id,
    title: conflictTitle(variant.title, name, at),
    content: variant.content,
    content_text: variant.content_text,
    tags: [...variant.tags],
    pinned: false,
    version: 0,
    created_by: userId,
    updated_by: userId,
    created_at: stamp,
    updated_at: stamp,
    deleted_at: null,
    purged_at: null,
  }
}

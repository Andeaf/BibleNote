import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BibleNoteDb } from '@/lib/db'
import { contentOf } from '@/sync/conflicts'
import { createFolder, trashFolder } from './folders'
import {
  createNote,
  discardIfEmpty,
  moveNote,
  saveNoteContent,
  setNotePinned,
  trashNote,
} from './notes'

const USER = 'user-1'
const SPACE = 'space-a'
const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})
const content = (title: string, text: string) => ({
  title,
  content: body(text),
  content_text: text,
  tags: [] as string[],
})

let db: BibleNoteDb

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
})

afterEach(() => db.close())

describe('notes data layer', () => {
  it('a new note stays on this device until its first change, which queues its create', async () => {
    const note = await createNote(db, USER, SPACE, null)
    expect(await db.outbox.count()).toBe(0)

    await saveNoteContent(db, USER, note.id, contentOf(note), content('T', 'one'))
    const second = contentOf((await db.notes.get(note.id))!)
    await saveNoteContent(db, USER, note.id, second, content('T', 'two'))

    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ op: 'save_note', base_version: null })
    expect(entries[0]?.payload).toMatchObject({
      id: note.id,
      space_id: SPACE,
      folder_id: null,
      pinned: false,
      content_text: 'two',
    })
  })

  it('drops an untouched empty note when the editor closes, never one that was saved', async () => {
    const empty = await createNote(db, USER, SPACE, null)
    await discardIfEmpty(db, empty.id)
    expect(await db.notes.get(empty.id)).toBeUndefined()

    const saved = await createNote(db, USER, SPACE, null)
    await saveNoteContent(db, USER, saved.id, contentOf(saved), content('T', 'x'))
    const now = contentOf((await db.notes.get(saved.id))!)
    await saveNoteContent(db, USER, saved.id, now, content('', ''))
    await discardIfEmpty(db, saved.id)
    expect(await db.notes.get(saved.id)).toBeDefined()
  })

  it('a metadata change on a note that exists only here creates it, with the change', async () => {
    const note = await createNote(db, USER, SPACE, null)
    await setNotePinned(db, note.id, true)
    const entries = await db.outbox.toArray()
    expect(entries.map((e) => [e.op, e.base_version, e.payload.pinned])).toEqual([
      ['save_note', null, true],
    ])
  })

  it('metadata changes are update entries behind the save_note, never merged into it', async () => {
    const note = await createNote(db, USER, SPACE, null)
    await saveNoteContent(db, USER, note.id, contentOf(note), content('T', 'x'))
    await setNotePinned(db, note.id, true)
    const now = contentOf((await db.notes.get(note.id))!)
    await saveNoteContent(db, USER, note.id, now, content('T', 'y'))
    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => [e.op, e.payload.content_text ?? e.payload.pinned])).toEqual([
      ['save_note', 'y'],
      ['update', true],
    ])
  })

  it('a save based on content that changed underneath becomes a conflict copy', async () => {
    const theirs = content('T', 'theirs')
    await db.notes.put({
      ...(await createNote(db, USER, SPACE, null)),
      id: 'n-a',
      ...content('T', 'mine'),
      version: 1,
    })
    const base = contentOf((await db.notes.get('n-a'))!)
    // A pull brought another device's version while the editor had unsaved typing.
    await db.notes.update('n-a', { ...theirs, version: 2 })

    const result = await saveNoteContent(db, USER, 'n-a', base, content('T', 'mine, more'))
    expect(result.status).toBe('copied')
    const copyId = result.status === 'copied' ? result.noteId : ''
    expect(await db.notes.get('n-a')).toMatchObject({ content_text: 'theirs', version: 2 })
    expect(await db.notes.get(copyId)).toMatchObject({
      content_text: 'mine, more',
      version: 0,
      folder_id: null,
    })
    expect((await db.notes.get(copyId))?.title).toMatch(/^T \(conflict – /)
    const entries = await db.outbox.toArray()
    expect(entries.map((e) => [e.row_id, e.op, e.base_version])).toEqual([
      [copyId, 'save_note', null],
    ])
  })

  it('moves only to a live folder of the same space', async () => {
    const note = await createNote(db, USER, SPACE, null)
    const folder = await createFolder(db, USER, SPACE, null, {
      name: 'F',
      color: null,
      emoji: null,
    })
    const other = await createFolder(db, USER, 'space-b', null, {
      name: 'O',
      color: null,
      emoji: null,
    })
    expect(await moveNote(db, note.id, other.id)).toBe(false)
    expect(await moveNote(db, note.id, folder.id)).toBe(true)
    expect((await db.notes.get(note.id))?.folder_id).toBe(folder.id)
    expect(await moveNote(db, note.id, folder.id)).toBe(false)
  })

  it('trashing drops empty notes that never left this device and trashes the rest', async () => {
    const folder = await createFolder(db, USER, SPACE, null, {
      name: 'F',
      color: null,
      emoji: null,
    })
    const empty = await createNote(db, USER, SPACE, folder.id)
    const written = await createNote(db, USER, SPACE, folder.id)
    await saveNoteContent(db, USER, written.id, contentOf(written), content('T', 'x'))
    await trashFolder(db, USER, folder.id)
    expect(await db.notes.get(empty.id)).toBeUndefined()
    expect((await db.notes.get(written.id))?.deleted_at).toBe(
      (await db.folders.get(folder.id))?.deleted_at,
    )

    const single = await createNote(db, USER, SPACE, null)
    await saveNoteContent(db, USER, single.id, contentOf(single), content('S', 'x'))
    await trashNote(db, single.id)
    expect((await db.notes.get(single.id))?.deleted_at).not.toBeNull()
  })
})

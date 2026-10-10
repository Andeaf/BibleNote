import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFolder } from '@/data/folders'
import { createNote, moveNote, saveNoteContent, setNotePinned } from '@/data/notes'
import { createSpace } from '@/data/spaces'
import { BibleNoteDb } from '@/lib/db'
import { contentOf } from './conflicts'
import { SyncEngine, backoffMs } from './engine'
import { FakeApi, forbiddenError, networkError, serverError } from './testing/fakeApi'
import type { OutboxEntry, SyncNotice } from './types'

/**
 * Notes through the sync engine (docs/PLAN.md §4.2, §4.5, §4.6b). A save_note for a note the
 * server does not have yet is a create and follows every insert rule.
 */

const USER = 'user-1'
const SPACE = 'space-aaaaaaaa'
const blank = { color: null, emoji: null }

let db: BibleNoteDb
let api: FakeApi
let notices: SyncNotice[]
let clock: number
let engine: SyncEngine

function makeEngine() {
  return new SyncEngine({
    db,
    api,
    userId: USER,
    now: () => clock,
    onNotice: (n) => notices.push(n),
    setTimer: () => undefined,
    clearTimer: () => undefined,
  })
}

function seedSpace() {
  api.seed('spaces', { id: SPACE, owner_id: USER, name: 'Space', color: null, emoji: null })
  api.access.push({ id: SPACE, role: 'owner' })
}

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** What the editor's autosave does: new content, based on what the note holds now. */
async function writeNote(noteId: string, title: string, text = title) {
  const note = await db.notes.get(noteId)
  if (!note) throw new Error(`no note ${noteId}`)
  return saveNoteContent(db, USER, noteId, contentOf(note), {
    title,
    content: body(text),
    content_text: text,
    tags: note.tags,
  })
}

async function newNote(spaceId: string, folderId: string | null, title: string) {
  const note = await createNote(db, USER, spaceId, folderId)
  await writeNote(note.id, title)
  return note
}

function seedNote(id: string, folderId: string | null, text: string) {
  return api.seed('notes', {
    id,
    space_id: SPACE,
    folder_id: folderId,
    title: 'N',
    content: body(text),
    content_text: text,
    tags: ['rugăciune'],
    pinned: false,
    version: 1,
    created_by: USER,
    updated_by: USER,
  })
}

const saveCalls = (noteId?: string) =>
  api.calls.filter((c) => c.method === 'saveNote' && (!noteId || c.id === noteId))

/** [table, op, status, attempts, base_version] of every entry, in queue order. */
const entries = async () =>
  (await db.outbox.orderBy('seq').toArray()).map((e) => [
    e.table,
    e.op,
    e.status,
    e.attempts,
    e.base_version,
  ])

const copyOf = async (noteId: string) => (await db.notes.toArray()).find((n) => n.id !== noteId)

const isCreate = (entry: OutboxEntry | undefined) =>
  entry?.op === 'save_note' && entry.base_version === null

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  api = new FakeApi()
  api.me = USER
  notices = []
  clock = Date.parse('2026-06-01T00:00:00Z')
  engine = makeEngine()
})

afterEach(() => {
  engine.dispose()
  db.close()
})

describe('save_note for a note the server does not have yet follows the insert rules', () => {
  it('waits for the insert of its folder without using attempts, then follows it', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const note = await newNote(SPACE, folder.id, 'N')
    let fail = true
    api.failWhen = (call) =>
      fail && call.method === 'insert' && call.payload?.id === folder.id ? serverError() : undefined

    await engine.push()
    expect(await entries()).toEqual([
      ['folders', 'insert', 'pending', 1, undefined],
      ['notes', 'save_note', 'pending', 0, null],
    ])
    expect(saveCalls()).toHaveLength(0)
    expect(notices).toEqual([])

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)?.folder_id).toBe(folder.id)
    expect((await db.notes.get(note.id))?.version).toBe(1)
    expect(saveCalls(note.id).map((c) => c.baseVersion)).toEqual([null])
  })

  it('waits for the insert of its main folder', async () => {
    const space = await createSpace(db, USER, { name: 'S', ...blank })
    const note = await newNote(space.id, null, 'N')
    let fail = true
    api.failWhen = (call) => (fail && call.table === 'spaces' ? serverError() : undefined)

    await engine.push()
    const entry = (await db.outbox.toArray()).find((e) => e.row_id === note.id)
    expect([entry?.status, entry?.attempts]).toEqual(['pending', 0])
    expect(saveCalls()).toHaveLength(0)
    expect(notices).toEqual([])

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)?.space_id).toBe(space.id)
  })

  it('moves to the root on BN_FOLDER_DELETED (folder trashed on another device)', async () => {
    seedSpace()
    const folder = api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    const note = await newNote(SPACE, 'f-a', 'N')
    api.seed('folders', { ...folder, deleted_at: '2026-01-02T00:00:00.000Z' })

    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)?.folder_id).toBeNull()
    expect((await db.notes.get(note.id))?.folder_id).toBeNull()
    expect(notices).toEqual([{ kind: 'moved_to_root', table: 'notes', name: 'N' }])
  })

  it('moves to the root on BN_FOLDER_NOT_IN_SPACE, only once its folder has no insert left', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const note = await newNote(SPACE, folder.id, 'N')
    api.failWhen = (call) =>
      call.method === 'insert' && call.payload?.id === folder.id ? forbiddenError() : undefined

    await engine.push()
    // The folder failed; the note waits for "Reîncearcă" or "Renunță" on it, never fails alone.
    expect(await entries()).toEqual([
      ['folders', 'insert', 'failed', 0, undefined],
      ['notes', 'save_note', 'pending', 0, null],
    ])
    expect(saveCalls()).toHaveLength(0)

    const [folderEntry] = await db.outbox.toArray()
    await engine.discard(folderEntry?.seq as number) // it never reached the server
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)?.folder_id).toBeNull()
    expect((await db.notes.get(note.id))?.folder_id).toBeNull()
    expect(notices.map((n) => n.kind)).toEqual(['failed', 'moved_to_root'])
  })

  it('is sent again after a reload left it in flight, without a conflict copy', async () => {
    seedSpace()
    await engine.pull()
    const note = await newNote(SPACE, null, 'N')
    // The create reached the server, then the app closed before the answer was stored.
    const [create] = await db.outbox.toArray()
    await api.saveNote({ ...create?.payload, id: note.id, space_id: SPACE }, null)
    await db.outbox.update(create?.seq as number, { status: 'inflight' })
    // An edit made meanwhile waits behind the entry in flight.
    await writeNote(note.id, 'N2')
    expect(await entries()).toEqual([
      ['notes', 'save_note', 'inflight', 0, null],
      ['notes', 'save_note', 'pending', 0, 0],
    ])

    engine.dispose()
    engine = makeEngine() // app restart
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.size).toBe(1)
    expect(api.tables.notes.get(note.id)).toMatchObject({ title: 'N2', version: 2 })
    expect(await db.notes.count()).toBe(1)
    expect((await db.notes.get(note.id))?.version).toBe(2)
    expect(saveCalls(note.id).map((c) => c.baseVersion)).toEqual([null, null, 1])
    expect(notices).toEqual([])
  })

  it('continues as an update of its own version when it is sent again with newer content', async () => {
    seedSpace()
    await engine.pull()
    const note = await newNote(SPACE, null, 'N')
    const [create] = await db.outbox.toArray()
    // It reached the server but the answer was lost; the next edit merges into the create.
    await api.saveNote({ ...create?.payload, id: note.id, space_id: SPACE }, null)
    await writeNote(note.id, 'N2')
    expect(await db.outbox.count()).toBe(1)

    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)).toMatchObject({ title: 'N2', version: 2 })
    expect(await db.notes.count()).toBe(1)
    expect(saveCalls(note.id).map((c) => c.baseVersion)).toEqual([null, null, 1])
    expect(notices).toEqual([])
  })

  it('keeps update_note_meta behind the create of its note', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const note = await newNote(SPACE, folder.id, 'N')
    await setNotePinned(db, note.id, true)
    let fail = true
    api.failWhen = (call) =>
      fail && call.method === 'insert' && call.payload?.id === folder.id ? serverError() : undefined

    await engine.push()
    expect(await entries()).toEqual([
      ['folders', 'insert', 'pending', 1, undefined],
      ['notes', 'save_note', 'pending', 0, null],
      ['notes', 'update', 'pending', 0, undefined],
    ])
    expect(api.calls.filter((c) => c.method === 'update')).toHaveLength(0)

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(note.id)?.pinned).toBe(true)
  })
})

describe('conflicts', () => {
  it('keeps the server version and saves the local variant, queued edits included, as a copy', async () => {
    seedSpace()
    api.seed('profiles', { id: USER, display_name: 'David' })
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    // A second edit queued behind the first one (that one was in flight when it was typed).
    const [first] = await db.outbox.toArray()
    await db.outbox.update(first?.seq as number, { status: 'inflight' })
    await writeNote('n-a', 'N', 'mine 2')
    await db.outbox.update(first?.seq as number, { status: 'pending' })
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs' })

    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(saveCalls('n-a')).toHaveLength(1)
    expect(api.tables.notes.get('n-a')).toMatchObject({ content_text: 'theirs', version: 2 })
    expect(await db.notes.get('n-a')).toMatchObject({ content_text: 'theirs', version: 2 })

    const copy = await copyOf('n-a')
    expect(copy?.title).toMatch(/^N \(conflict – David, \d{1,2} \S+ \d{4} \d{2}:\d{2}\)$/)
    expect(copy).toMatchObject({ content_text: 'mine 2', tags: ['rugăciune'], folder_id: null })
    expect(api.tables.notes.get(copy?.id as string)).toMatchObject({ version: 1 })
    expect(notices).toEqual([
      { kind: 'conflict', noteId: 'n-a', copyId: copy?.id, name: copy?.title },
    ])
  })

  it("sends the editor's last keystrokes to the copy, not over the other device's version", async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    const base = contentOf((await db.notes.get('n-a'))!)
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs' })
    await engine.push()
    const copy = await copyOf('n-a')

    // The editor was still open on the original, with typing not saved yet.
    const result = await saveNoteContent(db, USER, 'n-a', base, {
      ...base,
      content: body('mine, more'),
      content_text: 'mine, more',
    })
    expect(result).toEqual({ status: 'moved', noteId: copy?.id })
    expect(await db.notes.count()).toBe(2)
    expect(await db.notes.get(copy?.id as string)).toMatchObject({
      content_text: 'mine, more',
      title: copy?.title,
    })
    await engine.push()
    expect(api.tables.notes.get('n-a')?.content_text).toBe('theirs')
    expect(api.tables.notes.get(copy?.id as string)?.content_text).toBe('mine, more')
  })

  it('a conflict copy waits for the insert of its folder', async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    expect(await moveNote(db, 'n-a', folder.id)).toBe(true)
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs' })
    let fail = true
    api.failWhen = (call) =>
      fail && call.method === 'insert' && call.payload?.id === folder.id ? serverError() : undefined

    await engine.push()
    const copy = await copyOf('n-a')
    expect(copy?.folder_id).toBe(folder.id)
    expect(await entries()).toEqual([
      ['folders', 'insert', 'pending', 1, undefined],
      ['notes', 'update', 'pending', 0, undefined],
      ['notes', 'save_note', 'pending', 0, null],
    ])
    expect(saveCalls(copy?.id)).toHaveLength(0)

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.get(copy?.id as string)?.folder_id).toBe(folder.id)
    expect(api.tables.notes.get('n-a')).toMatchObject({
      folder_id: folder.id,
      content_text: 'theirs',
    })
    expect(notices.map((n) => n.kind)).toEqual(['conflict'])
  })

  it('a conflict copy moves to the root when its folder was deleted on another device', async () => {
    seedSpace()
    const folder = api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    seedNote('n-a', 'f-a', 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    // Another device edits the note, then trashes its folder (the note goes with it).
    const trashed = '2026-01-02T00:00:00.000Z'
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs', deleted_at: trashed })
    api.seed('folders', { ...folder, deleted_at: trashed })

    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    const copy = await copyOf('n-a')
    expect(copy?.folder_id).toBeNull()
    expect(api.tables.notes.get(copy?.id as string)).toMatchObject({
      folder_id: null,
      content_text: 'mine',
    })
    expect(notices.map((n) => n.kind)).toEqual(['conflict', 'moved_to_root'])
  })

  it('a conflict copy left in flight by a reload is sent again without a second copy', async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs' })
    api.failWhen = (call) =>
      call.method === 'saveNote' && call.id !== 'n-a' ? networkError() : undefined
    await engine.push()
    const [copyEntry] = await db.outbox.toArray()
    expect(isCreate(copyEntry)).toBe(true)

    // The copy's request reached the server; the app closed before the answer was stored.
    api.failWhen = () => undefined
    await api.saveNote({ ...copyEntry?.payload, id: copyEntry?.row_id, space_id: SPACE }, null)
    await db.outbox.update(copyEntry?.seq as number, { status: 'inflight' })
    engine.dispose()
    engine = makeEngine()
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.notes.size).toBe(2)
    expect(await db.notes.count()).toBe(2)
    expect((await db.notes.get(copyEntry?.row_id as string))?.version).toBe(1)
    expect(notices.map((n) => n.kind)).toEqual(['conflict'])
  })
})

describe('save_note', () => {
  it('never touches metadata changed on another device', async () => {
    seedSpace()
    api.seed('folders', { id: 'f-b', space_id: SPACE, parent_id: null, name: 'B' })
    const row = seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    // Moved and pinned elsewhere: metadata only, the version does not change.
    api.seed('notes', { ...row, folder_id: 'f-b', pinned: true })

    await engine.push()
    expect(api.tables.notes.get('n-a')).toMatchObject({
      folder_id: 'f-b',
      pinned: true,
      content_text: 'mine',
      version: 2,
    })
    expect(await db.notes.get('n-a')).toMatchObject({ folder_id: 'f-b', pinned: true })
  })

  it('edits queued while a save is in flight continue from its new version', async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'A')
    const [first] = await db.outbox.toArray()
    await db.outbox.update(first?.seq as number, { status: 'inflight' })
    await writeNote('n-a', 'N', 'B')
    await db.outbox.update(first?.seq as number, { status: 'pending' })

    await engine.push()
    expect(saveCalls('n-a').map((c) => c.baseVersion)).toEqual([1, 2])
    expect(api.tables.notes.get('n-a')).toMatchObject({ content_text: 'B', version: 3 })
    expect(await db.notes.count()).toBe(1)
    expect(notices).toEqual([])
  })

  it('a new edit merges into the newest entry, so an older one can never overwrite it', async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'A')
    const [first] = await db.outbox.toArray()
    await db.outbox.update(first?.seq as number, { status: 'inflight' })
    await writeNote('n-a', 'N', 'B')
    // The request in flight failed for lack of network: that entry is pending again.
    await db.outbox.update(first?.seq as number, { status: 'pending' })
    await writeNote('n-a', 'N', 'C')

    const queued = await db.outbox.orderBy('seq').toArray()
    expect(queued.map((e) => e.payload.content_text)).toEqual(['A', 'C'])
    await engine.push()
    expect(api.tables.notes.get('n-a')?.content_text).toBe('C')
    expect((await db.notes.get('n-a'))?.content_text).toBe('C')
  })

  it('gone: the purged note and its queued changes are removed locally', async () => {
    seedSpace()
    const row = seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'Titlu', 'mine')
    await setNotePinned(db, 'n-a', true)
    api.seed('notes', { ...row, title: '', deleted_at: row.updated_at, purged_at: row.updated_at })

    await engine.push()
    expect(await db.notes.get('n-a')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
    expect(notices).toEqual([{ kind: 'gone', table: 'notes', name: 'Titlu' }])
  })

  it('pull never overwrites a note with queued changes', async () => {
    seedSpace()
    seedNote('n-a', null, 'v1')
    await engine.pull()
    await writeNote('n-a', 'N', 'mine')
    api.editNote('n-a', { content: body('theirs'), content_text: 'theirs' })
    await engine.pull()
    expect((await db.notes.get('n-a'))?.content_text).toBe('mine')
  })

  it('discard of a failed create removes the note; offline, discard changes nothing', async () => {
    seedSpace()
    await engine.pull()
    const note = await newNote(SPACE, null, 'N')
    api.failWhen = (call) => (call.method === 'saveNote' ? forbiddenError() : undefined)
    await engine.push()
    const [entry] = await db.outbox.toArray()
    expect(entry?.status).toBe('failed')

    const fetchByIds = api.fetchByIds.bind(api)
    api.fetchByIds = async () => {
      throw networkError()
    }
    await expect(engine.discard(entry?.seq as number)).rejects.toThrow()
    expect(await db.outbox.count()).toBe(1)
    expect(await db.notes.get(note.id)).toBeDefined()

    api.fetchByIds = fetchByIds
    await engine.discard(entry?.seq as number)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.notes.get(note.id)).toBeUndefined()
  })
})

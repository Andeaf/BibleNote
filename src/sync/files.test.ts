import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFiles, renameFile } from '@/data/files'
import { createFolder } from '@/data/folders'
import { createSpace } from '@/data/spaces'
import { BibleNoteDb } from '@/lib/db'
import { SyncEngine, backoffMs } from './engine'
import {
  FakeApi,
  forbiddenError,
  networkError,
  serverError,
  type FakeCall,
} from './testing/fakeApi'
import type { ApiError, SyncNotice } from './types'

/**
 * Files through the sync engine (docs/PLAN.md §4.6d):
 * 1. the Storage object first, then the row: no device sees a row before its file exists;
 * 2. idempotent: a taken path counts as uploaded, a 23505 on the row continues as an update;
 * 3. the row follows every insert rule; the blob stays until both stages are confirmed.
 * FakeApi fails the test outright if a file row is inserted before its object.
 */

const USER = 'user-1'
const SPACE = 'space-aaaaaaaa'
const blank = { color: null, emoji: null }

let db: BibleNoteDb
let api: FakeApi
let notices: SyncNotice[]
let clock: number
let engine: SyncEngine

function makeEngine(database = db) {
  return new SyncEngine({
    db: database,
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

async function newFile(spaceId: string, folderId: string | null, name = 'Predica') {
  const [row] = await addFiles(db, USER, spaceId, folderId, [
    {
      name,
      kind: 'audio',
      mime: 'audio/webm',
      blob: new Blob(['opus-bytes'], { type: 'audio/webm' }),
      durationSec: 12,
    },
  ])
  if (!row) throw new Error('no file')
  return row
}

/** The file requests in order: uploadObject, insert, update. */
const fileCalls = () =>
  api.calls
    .filter((c) => c.method === 'uploadObject' || c.table === 'files')
    .filter((c) => c.method !== 'pullPage' && c.method !== 'fetchByIds')
    .map((c) => c.method)

/** [table, op, status, attempts, uploaded] of every entry, in queue order. */
const entries = async () =>
  (await db.outbox.orderBy('seq').toArray()).map((e) => [
    e.table,
    e.op,
    e.status,
    e.attempts,
    e.uploaded ?? false,
  ])

const blobPending = async (fileId: string) => (await db.blobs.get(fileId))?.pending

/** Fails `method` calls (on files or objects) while `fail` is set. */
function failing(method: FakeCall['method'], error: () => ApiError) {
  const control = { fail: true }
  api.failWhen = (call) =>
    control.fail && call.method === method && (method === 'uploadObject' || call.table === 'files')
      ? error()
      : undefined
  return control
}

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

describe('1. the Storage object first, then the row', () => {
  it('uploads the object, then inserts the row; the blob is released only after both', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])
    expect(await blobPending(file.id)).toBe(1)

    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert'])
    expect(api.objects.get(`${SPACE}/${file.id}`)).toEqual({ size: 10, type: 'audio/webm' })
    expect(api.tables.files.get(file.id)).toMatchObject({
      name: 'Predica',
      storage_path: `${SPACE}/${file.id}`,
      size_bytes: 10,
      duration_sec: 12,
    })
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
    expect((await db.files.get(file.id))?.updated_at).toBe(
      api.tables.files.get(file.id)?.updated_at,
    )
  })

  it('never inserts the row while the object is missing, so another device sees nothing', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const upload = failing('uploadObject', serverError)

    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject'])
    expect(api.tables.files.size).toBe(0)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 1, false]])
    expect(await blobPending(file.id)).toBe(1)

    const other = new BibleNoteDb(`test-${crypto.randomUUID()}`)
    const otherEngine = makeEngine(other)
    await otherEngine.pull()
    expect(await other.files.count()).toBe(0)

    upload.fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'uploadObject', 'insert'])
    await otherEngine.pull()
    expect((await other.files.get(file.id))?.name).toBe('Predica')
    otherEngine.dispose()
    other.close()
  })

  it('a network error during the upload uses no attempt and inserts nothing', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    const upload = failing('uploadObject', networkError)

    await engine.push()
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])
    expect(api.tables.files.size).toBe(0)
    expect(engine.state.get().online).toBe(false)

    upload.fail = false
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.files.size).toBe(1)
  })
})

describe('2. idempotent: fixed path, 23505 continues as an update', () => {
  it('a lost upload answer: the resend finds the object and goes on with the row', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    let lose = true
    api.loseAnswerWhen = (call) => lose && call.method === 'uploadObject'

    await engine.push()
    // The object is on the server, the answer never arrived.
    expect(api.objects.size).toBe(1)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    lose = false
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'uploadObject', 'insert'])
    expect(api.objects.size).toBe(1)
    expect(api.tables.files.size).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
    expect(notices).toEqual([])
  })

  it('once the object is confirmed, a retry sends only the row', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const insert = failing('insert', serverError)

    await engine.push()
    expect(await entries()).toEqual([['files', 'upload', 'pending', 1, true]])
    // Not confirmed yet: the row is missing, so the content must stay.
    expect(await blobPending(file.id)).toBe(1)

    insert.fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'insert'])
    expect(api.tables.files.size).toBe(1)
    expect(await blobPending(file.id)).toBe(0)
  })

  it('a lost insert answer: 23505 continues as an update, with a rename made meanwhile', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    let lose = true
    api.loseAnswerWhen = (call) => lose && call.method === 'insert'

    await engine.push()
    expect(api.tables.files.size).toBe(1)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, true]])
    await renameFile(db, file.id, 'Predica de duminică')
    expect(await db.outbox.count()).toBe(1)

    lose = false
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'insert', 'update'])
    expect(api.tables.files.size).toBe(1)
    expect(api.tables.files.get(file.id)?.name).toBe('Predica de duminică')
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
    expect(notices).toEqual([])
  })

  it('a reload left the upload in flight after object and row arrived: no duplicate', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const [entry] = await db.outbox.toArray()
    // Both stages reached the server, then the app closed before storing the answers.
    await api.uploadObject(file.storage_path, new Blob(['opus-bytes']), 'audio/webm')
    await api.insert('files', entry?.payload ?? {})
    await db.outbox.update(entry?.seq as number, { status: 'inflight' })

    engine.dispose()
    engine = makeEngine() // app restart
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'uploadObject', 'insert', 'update'])
    expect(api.objects.size).toBe(1)
    expect(api.tables.files.size).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
  })
})

describe('3. the file row follows every insert rule', () => {
  it('waits for the insert of its folder without using attempts, uploading nothing', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const file = await newFile(SPACE, folder.id)
    let fail = true
    api.failWhen = (call) =>
      fail && call.method === 'insert' && call.payload?.id === folder.id ? serverError() : undefined

    await engine.push()
    expect(await entries()).toEqual([
      ['folders', 'insert', 'pending', 1, false],
      ['files', 'upload', 'pending', 0, false],
    ])
    expect(fileCalls()).toEqual([])
    expect(notices).toEqual([])

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(fileCalls()).toEqual(['uploadObject', 'insert'])
    expect(api.tables.files.get(file.id)?.folder_id).toBe(folder.id)
  })

  it('waits for the insert of its main folder (Storage needs the space too)', async () => {
    const space = await createSpace(db, USER, { name: 'S', ...blank })
    const file = await newFile(space.id, null)
    let fail = true
    api.failWhen = (call) => (fail && call.table === 'spaces' ? serverError() : undefined)

    await engine.push()
    const entry = (await db.outbox.toArray()).find((e) => e.row_id === file.id)
    expect([entry?.status, entry?.attempts]).toEqual(['pending', 0])
    expect(fileCalls()).toEqual([])

    fail = false
    clock += backoffMs(1)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.objects.has(`${space.id}/${file.id}`)).toBe(true)
    expect(api.tables.files.get(file.id)?.space_id).toBe(space.id)
  })

  it('moves to the root on BN_FOLDER_DELETED, without uploading the object again', async () => {
    seedSpace()
    const folder = api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    const file = await newFile(SPACE, 'f-a')
    api.seed('folders', { ...folder, deleted_at: '2026-01-02T00:00:00.000Z' })

    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'insert'])
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.files.get(file.id)?.folder_id).toBeNull()
    expect((await db.files.get(file.id))?.folder_id).toBeNull()
    expect(notices).toEqual([{ kind: 'moved_to_root', table: 'files', name: 'Predica' }])
  })

  it('moves to the root on BN_FOLDER_NOT_IN_SPACE, only once its folder has no insert left', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const file = await newFile(SPACE, folder.id)
    api.failWhen = (call) =>
      call.method === 'insert' && call.payload?.id === folder.id ? forbiddenError() : undefined

    await engine.push()
    // The folder failed; the file waits for "Reîncearcă" or "Renunță" on it, never fails alone.
    expect(await entries()).toEqual([
      ['folders', 'insert', 'failed', 0, false],
      ['files', 'upload', 'pending', 0, false],
    ])
    expect(fileCalls()).toEqual([])

    const [folderEntry] = await db.outbox.toArray()
    await engine.discard(folderEntry?.seq as number) // it never reached the server
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.files.get(file.id)?.folder_id).toBeNull()
    expect((await db.files.get(file.id))?.folder_id).toBeNull()
    expect(notices.map((n) => n.kind)).toEqual(['failed', 'moved_to_root'])
  })

  it('a rename before the upload rides along; one made during the upload waits behind it', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    await renameFile(db, file.id, 'A')
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    const [upload] = await db.outbox.toArray()
    await db.outbox.update(upload?.seq as number, { status: 'inflight' })
    await renameFile(db, file.id, 'B')
    expect(await entries()).toEqual([
      ['files', 'upload', 'inflight', 0, false],
      ['files', 'update', 'pending', 0, false],
    ])

    engine.dispose()
    engine = makeEngine()
    await engine.push()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'update'])
    const insert = api.calls.find((c) => c.method === 'insert' && c.table === 'files')
    expect(insert?.payload?.name).toBe('A')
    expect(api.tables.files.get(file.id)?.name).toBe('B')
    expect((await db.files.get(file.id))?.name).toBe('B')
  })

  it('discard of a failed upload removes the file and its content', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    failing('uploadObject', forbiddenError)

    await engine.push()
    expect(await entries()).toEqual([['files', 'upload', 'failed', 0, false]])
    expect(await blobPending(file.id)).toBe(1)

    const [entry] = await db.outbox.toArray()
    await engine.discard(entry?.seq as number)
    expect(await db.files.get(file.id)).toBeUndefined()
    expect(await db.blobs.get(file.id)).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('a missing local blob fails the upload instead of inserting a row without a file', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    await db.blobs.delete(file.id)

    await engine.push()
    expect(await entries()).toEqual([['files', 'upload', 'failed', 0, false]])
    expect(fileCalls()).toEqual([])
    expect(api.tables.files.size).toBe(0)
  })

  it('a purged file disappears locally together with its content', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    await engine.push()
    expect(await db.blobs.get(file.id)).toBeDefined()

    api.seed('files', { ...api.tables.files.get(file.id), id: file.id, purged_at: 'x' })
    clock += 60_000
    await engine.pull()
    expect(await db.files.get(file.id)).toBeUndefined()
    expect(await db.blobs.get(file.id)).toBeUndefined()
  })
})

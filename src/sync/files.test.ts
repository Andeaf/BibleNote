import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFiles, renameFile } from '@/data/files'
import { createFolder } from '@/data/folders'
import { createNote, saveNoteContent } from '@/data/notes'
import { createSpace } from '@/data/spaces'
import { BibleNoteDb } from '@/lib/db'
import { contentOf } from './conflicts'
import { SyncEngine, backoffMs } from './engine'
import {
  FakeApi,
  forbiddenError,
  networkError,
  serverError,
  type FakeCall,
} from './testing/fakeApi'
import { STALL_MS, TRANSFER_PAUSES_MS } from './transfers'
import type { ApiError, SyncNotice } from './types'

/**
 * Files through the sync engine (docs/PLAN.md §4.6d):
 * 1. the Storage object first, then the row: no device sees a row before its file exists;
 * 2. idempotent: a taken path counts as uploaded, a 23505 on the row continues as an update;
 * 3. the row follows every insert rule; the blob stays until both stages are confirmed;
 * 4. the transfer runs on its own lane: one at a time, never holding back the main queue,
 *    with pauses after network failures, cancelled when stalled, restarted after a reload.
 * FakeApi fails the test outright if a file row is inserted before its object.
 */

const USER = 'user-1'
const SPACE = 'space-aaaaaaaa'
const blank = { color: null, emoji: null }

interface FakeTimer {
  fn: () => void
  ms: number
  cleared: boolean
}

let db: BibleNoteDb
let api: FakeApi
let notices: SyncNotice[]
let clock: number
let online: boolean
let timers: FakeTimer[]
let engine: SyncEngine

function makeEngine(database = db) {
  return new SyncEngine({
    db: database,
    api,
    userId: USER,
    now: () => clock,
    onNotice: (n) => notices.push(n),
    // Recorded, never fired on their own: tests drive the clock and fire them.
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      if (handle) (handle as FakeTimer).cleared = true
    },
    isOnline: () => online,
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

/** Lets the main queue and the transfer lane run until nothing more can happen now. */
async function flush() {
  for (let i = 0; i < 4; i++) {
    await engine.push()
    await engine.transfers.run()
  }
}

/** Waits for something the engine does in the background (a held transfer, a saved note). */
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 400; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out')
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

/** [network failures, ms until the next transfer] of the first upload entry. */
const pause = async () => {
  const entry = (await db.outbox.toArray()).find((e) => e.op === 'upload')
  return [entry?.transfer_failures ?? 0, Math.max(0, (entry?.next_transfer_at ?? 0) - clock)]
}

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

/** Fires the stall watchdog of the transfer in progress. */
function fireStall() {
  const timer = timers.filter((t) => t.ms === STALL_MS && !t.cleared).at(-1)
  if (!timer) throw new Error('no stall watchdog')
  timer.fn()
}

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  api = new FakeApi()
  api.me = USER
  notices = []
  clock = Date.parse('2026-06-01T00:00:00Z')
  online = true
  timers = []
  engine = makeEngine()
})

afterEach(() => {
  api.releaseUploads()
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

    await flush()
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

    await flush()
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
    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'uploadObject', 'insert'])
    await otherEngine.pull()
    expect((await other.files.get(file.id))?.name).toBe('Predica')
    otherEngine.dispose()
    other.close()
  })

  it('offline, nothing is transferred and no pause grows; the online event starts it', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    online = false

    await flush()
    expect(fileCalls()).toEqual([])
    expect(await pause()).toEqual([0, 0])

    online = true
    engine.connectionRestored()
    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'insert'])
  })
})

describe('2. idempotent: fixed path, 23505 continues as an update', () => {
  it('a lost upload answer: the next transfer finds the object and goes on with the row', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    let lose = true
    api.loseAnswerWhen = (call) => lose && call.method === 'uploadObject'

    await flush()
    // The object is on the server, the answer never arrived (a network failure while online).
    expect(api.objects.size).toBe(1)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    lose = false
    clock += TRANSFER_PAUSES_MS[0]
    await flush()
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

    await flush()
    expect(await entries()).toEqual([['files', 'upload', 'pending', 1, true]])
    // Not confirmed yet: the row is missing, so the content must stay.
    expect(await blobPending(file.id)).toBe(1)

    insert.fail = false
    clock += backoffMs(1)
    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'insert'])
    expect(api.tables.files.size).toBe(1)
    expect(await blobPending(file.id)).toBe(0)
  })

  it('a lost insert answer: 23505 continues as an update, with a rename made meanwhile', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    let lose = true
    api.loseAnswerWhen = (call) => {
      if (!lose || call.method !== 'insert') return false
      lose = false
      return true
    }

    // The transfer starts the main queue, whose insert answer is lost.
    await engine.transfers.run()
    await until(() => fileCalls().includes('insert') && !engine.state.get().pushing)
    expect(api.tables.files.size).toBe(1)
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, true]])
    await renameFile(db, file.id, 'Predica de duminică')
    expect(await db.outbox.count()).toBe(1)

    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'insert', 'update'])
    expect(api.tables.files.size).toBe(1)
    expect(api.tables.files.get(file.id)?.name).toBe('Predica de duminică')
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
    expect(notices).toEqual([])
  })

  it('the app closed after object and row arrived: no duplicates on the next start', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const [entry] = await db.outbox.toArray()
    // Both stages reached the server, then the app closed before storing the answers.
    await api.uploadObject(file.storage_path, new Blob(['opus-bytes']), 'audio/webm')
    await api.insert('files', entry?.payload ?? {})

    engine.dispose()
    engine = makeEngine() // app restart
    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'insert', 'uploadObject', 'insert', 'update'])
    expect(api.objects.size).toBe(1)
    expect(api.tables.files.size).toBe(1)
    expect(await db.outbox.count()).toBe(0)
    expect(await blobPending(file.id)).toBe(0)
  })
})

describe('3. the file row follows every insert rule', () => {
  it('the row waits for the insert of its folder without using attempts', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, { name: 'Nou', ...blank })
    const file = await newFile(SPACE, folder.id)
    let fail = true
    api.failWhen = (call) =>
      fail && call.method === 'insert' && call.payload?.id === folder.id ? serverError() : undefined

    await flush()
    // The object only needs the main folder; the row waits for its folder.
    expect(await entries()).toEqual([
      ['folders', 'insert', 'pending', 1, false],
      ['files', 'upload', 'pending', 0, true],
    ])
    expect(fileCalls()).toEqual(['uploadObject'])
    expect(notices).toEqual([])

    fail = false
    clock += backoffMs(1)
    await flush()
    expect(await db.outbox.count()).toBe(0)
    expect(fileCalls()).toEqual(['uploadObject', 'insert'])
    expect(api.tables.files.get(file.id)?.folder_id).toBe(folder.id)
  })

  it('the transfer waits for the insert of its main folder (Storage needs the space)', async () => {
    const space = await createSpace(db, USER, { name: 'S', ...blank })
    const file = await newFile(space.id, null)
    let fail = true
    api.failWhen = (call) => (fail && call.table === 'spaces' ? serverError() : undefined)

    await flush()
    const entry = (await db.outbox.toArray()).find((e) => e.row_id === file.id)
    expect([entry?.status, entry?.attempts, entry?.uploaded ?? false]).toEqual([
      'pending',
      0,
      false,
    ])
    expect(fileCalls()).toEqual([])

    fail = false
    clock += backoffMs(1)
    await flush()
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

    await flush()
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

    await flush()
    // The folder failed; the row waits for "Reîncearcă" or "Renunță" on it, never fails alone.
    expect(await entries()).toEqual([
      ['folders', 'insert', 'failed', 0, false],
      ['files', 'upload', 'pending', 0, true],
    ])
    expect(fileCalls()).toEqual(['uploadObject'])

    const [folderEntry] = await db.outbox.toArray()
    await engine.discard(folderEntry?.seq as number) // it never reached the server
    await flush()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.files.get(file.id)?.folder_id).toBeNull()
    expect((await db.files.get(file.id))?.folder_id).toBeNull()
    expect(notices.map((n) => n.kind)).toEqual(['failed', 'moved_to_root'])
  })

  it('discard of a failed upload removes the file and its content', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    failing('uploadObject', forbiddenError)

    await flush()
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

    await flush()
    expect(await entries()).toEqual([['files', 'upload', 'failed', 0, false]])
    expect(fileCalls()).toEqual([])
    expect(api.tables.files.size).toBe(0)
  })

  it('a purged file disappears locally together with its content', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    await flush()
    expect(await db.blobs.get(file.id)).toBeDefined()

    api.seed('files', { ...api.tables.files.get(file.id), id: file.id, purged_at: 'x' })
    clock += 60_000
    await engine.pull()
    expect(await db.files.get(file.id)).toBeUndefined()
    expect(await db.blobs.get(file.id)).toBeUndefined()
  })
})

describe('4. the transfer lane', () => {
  it('a note is saved while a transfer hangs; the file follows when it is released', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const note = await createNote(db, USER, SPACE, null)
    api.holdUploads = true

    void engine.push()
    await until(() => api.heldUploads === 1)
    await saveNoteContent(db, USER, note.id, contentOf(note), {
      title: 'Scrisă acum',
      content: { type: 'doc', content: [] },
      content_text: '',
      tags: [],
    })
    await engine.push()
    expect(api.tables.notes.get(note.id)?.title).toBe('Scrisă acum')
    expect(engine.state.get().transfer).toMatchObject({ rowId: file.id, total: 10 })
    expect(api.tables.files.size).toBe(0)

    api.releaseUploads()
    await flush()
    expect(api.tables.files.size).toBe(1)
    expect(engine.state.get().transfer).toBeNull()
    expect(await db.outbox.count()).toBe(0)
  })

  it('one transfer at a time, in queue order', async () => {
    seedSpace()
    await engine.pull()
    const first = await newFile(SPACE, null, 'Unu')
    const second = await newFile(SPACE, null, 'Doi')
    api.holdUploads = true

    void engine.push()
    await until(() => api.heldUploads === 1)
    await engine.push()
    expect(api.heldUploads).toBe(1)
    expect(api.calls.filter((c) => c.method === 'uploadObject').map((c) => c.id)).toEqual([
      first.storage_path,
    ])

    api.releaseUploads()
    await flush()
    expect(api.calls.filter((c) => c.method === 'uploadObject').map((c) => c.id)).toEqual([
      first.storage_path,
      second.storage_path,
    ])
  })

  it('a rename during the transfer waits: the row is inserted with the new name', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    await renameFile(db, file.id, 'Nou')
    await engine.push()
    // Nothing reaches the server for the row before the object exists.
    expect(fileCalls()).toEqual(['uploadObject'])
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    api.releaseUploads()
    await flush()
    expect(fileCalls()).toEqual(['uploadObject', 'insert'])
    expect(api.tables.files.get(file.id)?.name).toBe('Nou')
  })

  it('a rename while the row is being inserted waits behind it', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    const insert = failing('insert', networkError)
    await engine.transfers.run()
    await until(() => fileCalls().includes('insert') && !engine.state.get().pushing)
    // The row insert is in flight when the app closes; a rename is made meanwhile.
    const [upload] = await db.outbox.toArray()
    await db.outbox.update(upload?.seq as number, { status: 'inflight' })
    await renameFile(db, file.id, 'B')
    expect(await entries()).toEqual([
      ['files', 'upload', 'inflight', 0, true],
      ['files', 'update', 'pending', 0, false],
    ])

    insert.fail = false
    engine.dispose()
    engine = makeEngine()
    await flush()
    expect(fileCalls().slice(-2)).toEqual(['insert', 'update'])
    expect(fileCalls().filter((c) => c === 'uploadObject')).toHaveLength(1)
    expect(api.calls.find((c) => c.method === 'insert' && c.table === 'files')?.payload?.name).toBe(
      'Predica',
    )
    expect(api.tables.files.get(file.id)?.name).toBe('B')
  })

  it('network failures while online pause the lane 1, 5, 15, then 60 minutes', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    const upload = failing('uploadObject', networkError)

    await flush()
    expect(await pause()).toEqual([1, 60_000])
    // Other triggers (edits, focus, realtime) do not retry it before the pause ends.
    await flush()
    expect(fileCalls()).toEqual(['uploadObject'])
    expect(engine.transfers.nextWakeAt).toBe(clock + 60_000)
    // The main queue is not reported offline because of it.
    expect(engine.state.get().online).toBe(true)

    for (const [failures, ms] of [
      [2, 5 * 60_000],
      [3, 15 * 60_000],
      [4, 60 * 60_000],
      [5, 60 * 60_000],
    ]) {
      clock += (await pause())[1] as number
      await flush()
      expect(await pause()).toEqual([failures, ms])
    }
    expect(fileCalls()).toHaveLength(5)

    // The online event starts over at once.
    upload.fail = false
    engine.connectionRestored()
    await flush()
    expect(api.tables.files.size).toBe(1)
  })

  it('a transfer cut while the page was in the background does not grow the pause', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    engine.setVisible(false)
    fireStall() // the cut shows up as a cancelled request
    await until(async () => engine.state.get().transfer === null)
    await engine.transfers.run()
    expect(await pause()).toEqual([0, 0])
    expect(api.calls.filter((c) => c.method === 'uploadObject')).toHaveLength(1)

    api.releaseUploads()
    engine.setVisible(true)
    await flush()
    expect(api.tables.files.size).toBe(1)
  })

  it('the page is visible again before the error of a transfer cut in the background: it goes again at once', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    // iOS: `visibilitychange` comes back first, the cut request (or its stall timer) fails after.
    engine.setVisible(false)
    engine.setVisible(true)
    fireStall()
    // No second return to the app needed, and no pause.
    await until(() => api.heldUploads === 2)
    expect(await pause()).toEqual([0, 0])

    api.releaseUploads()
    await flush()
    expect(api.tables.files.size).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })

  it('a transfer without progress for 60 s is cancelled as a network failure', async () => {
    seedSpace()
    await engine.pull()
    await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    fireStall()
    await until(async () => (await pause())[0] === 1)
    expect(await pause()).toEqual([1, 60_000])
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    api.releaseUploads()
    clock += 60_000
    await flush()
    expect(api.tables.files.size).toBe(1)
  })

  it('a transfer interrupted by closing the app starts again at the next start', async () => {
    seedSpace()
    await engine.pull()
    const file = await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)
    // The entry was never marked in flight, so recovering such entries cannot touch it.
    expect(await entries()).toEqual([['files', 'upload', 'pending', 0, false]])

    engine.dispose() // the app closes
    api.releaseUploads()
    engine = makeEngine()
    await flush()
    expect(await pause()).toEqual([0, 0])
    expect(api.calls.filter((c) => c.method === 'uploadObject')).toHaveLength(2)
    expect(api.tables.files.get(file.id)?.name).toBe('Predica')
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('changes that never reached the server survive a lost access', () => {
  it('keeps unsent note text and files, failed with BN_ACCESS_LOST, until discarded', async () => {
    api.seed('spaces', {
      id: SPACE,
      owner_id: 'user-other',
      name: 'Shared',
      color: null,
      emoji: null,
    })
    api.access.push({ id: SPACE, role: 'editor' })
    api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    online = false // nothing leaves the device before the access is gone
    const file = await newFile(SPACE, null)
    const note = await createNote(db, USER, SPACE, 'f-a')
    await saveNoteContent(db, USER, note.id, contentOf(note), {
      title: 'Offline',
      content: { type: 'doc', content: [] },
      content_text: 'text scris offline',
      tags: [],
    })

    api.access = []
    clock += 60_000
    await engine.pull()
    expect(notices).toEqual([{ kind: 'access_lost', name: 'Shared' }])
    expect(await db.spaces.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
    const kept = await db.outbox.orderBy('seq').toArray()
    expect(kept.map((e) => [e.table, e.status, e.last_error])).toEqual([
      ['files', 'failed', 'BN_ACCESS_LOST'],
      ['notes', 'failed', 'BN_ACCESS_LOST'],
    ])
    expect((await db.notes.get(note.id))?.content_text).toBe('text scris offline')
    expect(await (await db.blobs.get(file.id))?.blob.text()).toBe('opus-bytes')

    // "Renunță" works offline for these: the server would not show the rows anyway.
    for (const entry of kept) await engine.discard(entry.seq as number)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.notes.count()).toBe(0)
    expect(await db.blobs.count()).toBe(0)
  })

  /** A shared space where I am an editor, pulled. */
  async function sharedSpace() {
    api.seed('spaces', { id: SPACE, owner_id: 'user-other', name: 'Shared', ...blank })
    api.access.push({ id: SPACE, role: 'editor' })
    await engine.pull()
  }

  const fetchCalls = () => api.calls.filter((c) => c.method === 'fetchByIds').length

  it('losing access cancels the transfer in progress; the entry stays BN_ACCESS_LOST', async () => {
    await sharedSpace()
    const file = await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    api.access = []
    clock += 60_000
    await engine.pull()
    // The cancelled request comes back as a network failure: nothing of it reaches the entry.
    await until(async () => engine.state.get().transfer === null)
    await engine.transfers.run()
    const [entry] = await db.outbox.toArray()
    expect([entry?.status, entry?.last_error, entry?.uploaded ?? false]).toEqual([
      'failed',
      'BN_ACCESS_LOST',
      false,
    ])
    expect(await pause()).toEqual([0, 0])
    expect(api.calls.filter((c) => c.method === 'uploadObject')).toHaveLength(1)
    expect(await (await db.blobs.get(file.id))?.blob.text()).toBe('opus-bytes')

    // "Renunță" still recognises it: dropped locally, the server is not asked.
    online = false
    const before = fetchCalls()
    await engine.discard(entry?.seq as number)
    expect(fetchCalls()).toBe(before)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    expect(await db.blobs.count()).toBe(0)
  })

  it('a transfer that ends after its entry failed only marks it uploaded', async () => {
    await sharedSpace()
    await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    // The object is stored just before the access is gone, too late for the cancel to stop it.
    const [held] = await db.outbox.toArray()
    await db.outbox.update(held?.seq as number, {
      status: 'failed',
      last_error: 'BN_ACCESS_LOST',
      attempts: 2,
    })
    api.releaseUploads()
    await until(async () => engine.state.get().transfer === null)
    await flush()

    const [entry] = await db.outbox.toArray()
    expect(entry).toMatchObject({
      status: 'failed',
      last_error: 'BN_ACCESS_LOST',
      attempts: 2,
      uploaded: true,
    })
    expect(api.tables.files.size).toBe(0)
    expect(notices.filter((n) => n.kind === 'failed')).toEqual([])
  })

  it('a failure that ends after its entry failed leaves the entry as it is', async () => {
    await sharedSpace()
    await newFile(SPACE, null)
    api.holdUploads = true
    void engine.push()
    await until(() => api.heldUploads === 1)

    const [held] = await db.outbox.toArray()
    await db.outbox.update(held?.seq as number, { status: 'failed', last_error: 'BN_ACCESS_LOST' })
    // The Storage policy refuses it now, as it would after the access was removed.
    failing('uploadObject', forbiddenError)
    api.releaseUploads()
    await until(async () => engine.state.get().transfer === null)
    await flush()

    const [entry] = await db.outbox.toArray()
    expect(entry).toMatchObject({ status: 'failed', last_error: 'BN_ACCESS_LOST' })
    expect(entry?.uploaded ?? false).toBe(false)
    expect(notices.filter((n) => n.kind === 'failed')).toEqual([])
  })
})

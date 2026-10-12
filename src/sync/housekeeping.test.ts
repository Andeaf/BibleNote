import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFiles } from '@/data/files'
import { BibleNoteDb } from '@/lib/db'
import { OBJECT_RECHECK_MS, SyncEngine } from './engine'
import {
  HOUSEKEEPING_INTERVAL_MS,
  ORPHAN_MIN_AGE_MS,
  PENDING_REMOVALS_KEY,
  sweepOrphans,
} from './housekeeping'
import { FakeApi, networkError, type FakeCall } from './testing/fakeApi'

/**
 * The owner's cleanup (docs/PLAN.md §5.8, rev. 15): the 30-day emptying and the orphan sweep can
 * delete for good, so they never act on a local copy that was not refreshed, never on objects a
 * row may still come for, and never on what the server does not consider expired.
 */

const USER = 'user-1'
const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002'
const DAY = 24 * 60 * 60 * 1000
const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
const path = (n: number, space = SPACE) => `${space}/${id(n)}`

let db: BibleNoteDb
let api: FakeApi
let clock: number
let engine: SyncEngine

function makeEngine() {
  return new SyncEngine({
    db,
    api,
    userId: USER,
    now: () => clock,
    setTimer: () => null,
    clearTimer: () => undefined,
  })
}

/** The server's ISO time `ms` ago. */
const ago = (ms: number) => new Date(Date.parse(api.serverNow()) - ms).toISOString()

function fileRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: id(n),
    space_id: SPACE,
    folder_id: null,
    name: `F${n}`,
    kind: 'audio',
    mime: 'audio/webm',
    size_bytes: 1,
    storage_path: path(n),
    duration_sec: null,
    created_by: 'user-2',
    ...extra,
  }
}

const calls = (method: FakeCall['method']) => api.calls.filter((c) => c.method === method)

async function pullAndClean() {
  await engine.pull()
  await engine.housekeepingRun
}

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  api = new FakeApi()
  api.me = USER
  api.seed('spaces', { id: SPACE, owner_id: USER, name: 'Mine', color: null, emoji: null })
  api.access.push({ id: SPACE, role: 'owner' })
  clock = Date.parse('2026-06-01T00:00:00Z')
  engine = makeEngine()
})

afterEach(async () => {
  await engine.housekeepingRun
  engine.dispose()
  db.close()
})

describe('only after a successful pull of this session', () => {
  it('nothing is purged or swept while the pull fails; the first good pull starts it', async () => {
    api.seedObject(path(1), 40 * DAY)
    api.failWhen = (call) => (call.method === 'pullPage' ? networkError() : undefined)
    await engine.pull()
    await engine.housekeepingRun
    expect([calls('purgeExpired'), calls('listObjects'), calls('removeObjects')]).toEqual([
      [],
      [],
      [],
    ])
    expect(api.objects.has(path(1))).toBe(true)

    api.failWhen = () => undefined
    await pullAndClean()
    expect(calls('purgeExpired')).toHaveLength(1)
    expect(api.objects.has(path(1))).toBe(false)
  })

  it('a new session waits for its own pull, even with an old local copy', async () => {
    await pullAndClean()
    clock += 2 * HOUSEKEEPING_INTERVAL_MS
    engine.dispose()
    engine = makeEngine() // the app starts again
    api.seedObject(path(1), 40 * DAY)
    await engine.push()
    expect(calls('listObjects')).toHaveLength(1) // only the run of the first session
    await pullAndClean()
    expect(calls('listObjects')).toHaveLength(2)
    expect(api.objects.has(path(1))).toBe(false)
  })

  it('at most hourly, and only for the spaces the user owns', async () => {
    api.seed('spaces', { id: OTHER, owner_id: 'user-2', name: 'Shared', color: null, emoji: null })
    api.access.push({ id: OTHER, role: 'editor' })
    await pullAndClean()
    await pullAndClean()
    expect(calls('listObjects').map((c) => c.id)).toEqual([SPACE])
    clock += HOUSEKEEPING_INTERVAL_MS
    await pullAndClean()
    expect(calls('listObjects').map((c) => c.id)).toEqual([SPACE, SPACE])
  })
})

describe('the orphan sweep compares with the server, never with the local copy', () => {
  it('a file another device added, not pulled here yet, keeps its object', async () => {
    api.seed('files', fileRow(1))
    api.seedObject(path(1), 40 * DAY)
    // A device that never pulled: no rows locally at all.
    const removed = await sweepOrphans({ db, api }, SPACE, Date.parse(api.serverNow()))
    expect(removed).toEqual([])
    expect(api.objects.has(path(1))).toBe(true)
  })

  it('a row that reaches the server while the sweep runs keeps its object', async () => {
    api.seedObject(path(1), 40 * DAY)
    // Another device inserts the row right after the sweep read the rows the first time.
    api.beforeCall = (call) => {
      if (call.method === 'fetchByIds' && call.table === 'files') api.seed('files', fileRow(1))
    }
    const removed = await sweepOrphans({ db, api }, SPACE, Date.parse(api.serverNow()))
    expect(removed).toEqual([])
    expect(api.objects.has(path(1))).toBe(true)
  })

  it('an object without a row goes only after 30 days (server clock): its row may be queued', async () => {
    api.seedObject(path(1), 29 * DAY) // the row still waits in another device's outbox
    api.seedObject(path(2), ORPHAN_MIN_AGE_MS + DAY)
    // The device's own clock is 40 days ahead: it does not count.
    clock += 40 * DAY
    await pullAndClean()
    expect(api.objects.has(path(1))).toBe(true)
    expect(api.objects.has(path(2))).toBe(false)
  })

  it('the objects of this device’s own unsent uploads are never touched', async () => {
    await engine.pull()
    const [row] = await addFiles(db, USER, SPACE, null, [
      { name: 'Predica', kind: 'audio', mime: 'audio/webm', blob: new Blob(['x']), durationSec: 1 },
    ])
    // Its object went up 40 days ago; the row is still in this outbox.
    api.seedObject(`${SPACE}/${row?.id}`, 40 * DAY)
    const removed = await sweepOrphans({ db, api }, SPACE, Date.parse(api.serverNow()))
    expect(removed).toEqual([])
  })

  it('an object whose row is purged goes at once; live rows keep theirs', async () => {
    api.seed('files', fileRow(1, { deleted_at: ago(DAY), purged_at: ago(DAY), name: '' }))
    api.seed('files', fileRow(2))
    api.seedObject(path(1), DAY)
    api.seedObject(path(2), 400 * DAY)
    await pullAndClean()
    expect([api.objects.has(path(1)), api.objects.has(path(2))]).toEqual([false, true])
  })

  it('reads every page of rows of a space', async () => {
    for (let n = 1; n <= 1203; n++) api.seed('files', fileRow(n))
    api.seedObject(path(1203), 40 * DAY)
    const removed = await sweepOrphans({ db, api }, SPACE, Date.parse(api.serverNow()))
    expect(removed).toEqual([])
    expect(calls('pullPage').filter((c) => c.page?.spaceId === SPACE)).toHaveLength(3)
  })
})

describe('the 30-day emptying is decided by the server', () => {
  it('purges what the server has had in the trash for 30 days, and removes its objects', async () => {
    api.seed('files', fileRow(1, { deleted_at: ago(31 * DAY) }))
    api.seed('files', fileRow(2, { deleted_at: ago(29 * DAY) }))
    api.seedObject(path(1), 60 * DAY)
    api.seedObject(path(2), 60 * DAY)
    await pullAndClean()
    expect(api.tables.files.get(id(1))?.purged_at).not.toBeNull()
    expect(api.tables.files.get(id(2))?.purged_at).toBeNull()
    expect([api.objects.has(path(1)), api.objects.has(path(2))]).toEqual([false, true])
  })

  it('restored and deleted again recently: not purged, whatever the local copy says', async () => {
    api.seed('notes', {
      id: id(7),
      space_id: SPACE,
      folder_id: null,
      title: 'Restaurată',
      content: {},
      content_text: '',
      tags: [],
      pinned: false,
      version: 1,
      deleted_at: ago(40 * DAY),
    })
    const old = api.tables.notes.get(id(7))?.deleted_at
    api.failWhen = (call) => (call.method === 'purgeExpired' ? networkError() : undefined)
    await pullAndClean()
    api.failWhen = () => undefined
    // Restored and deleted again yesterday on another device; this device has not pulled since.
    const note = api.tables.notes.get(id(7))
    if (note) {
      api.tables.notes.set(id(7), { ...note, deleted_at: ago(DAY), trashed_at: ago(DAY) })
    }
    expect((await db.notes.get(id(7)))?.deleted_at).toBe(old)
    clock += HOUSEKEEPING_INTERVAL_MS
    await pullAndClean()
    expect(api.tables.notes.get(id(7))?.purged_at).toBeNull()
    expect(api.tables.notes.get(id(7))?.title).toBe('Restaurată')
  })

  it('a device whose date is a year behind still gives the item its 30 days', async () => {
    api.seed('files', fileRow(4))
    await pullAndClean()
    // This phone thinks it is a year earlier: the deleted_at it sends is a year old.
    const wrong = ago(365 * DAY)
    await db.files.update(id(4), { deleted_at: wrong })
    await db.outbox.add({
      table: 'files',
      row_id: id(4),
      space_id: SPACE,
      op: 'update',
      payload: { deleted_at: wrong },
      status: 'pending',
      attempts: 0,
      created_at: clock,
      next_attempt_at: 0,
      last_error: null,
    })
    await engine.push()
    expect(api.tables.files.get(id(4))?.deleted_at).toBe(wrong)
    clock += HOUSEKEEPING_INTERVAL_MS
    await pullAndClean()
    expect(api.tables.files.get(id(4))?.purged_at).toBeNull()
    // Thirty days later on the server, it goes.
    api.advance(31 * DAY)
    clock += HOUSEKEEPING_INTERVAL_MS
    await pullAndClean()
    expect(api.tables.files.get(id(4))?.purged_at).not.toBeNull()
  })

  it('removals cut short are finished by the next run', async () => {
    api.seed('files', fileRow(1, { deleted_at: ago(31 * DAY) }))
    api.seedObject(path(1), 60 * DAY)
    api.failWhen = (call) => (call.method === 'removeObjects' ? networkError() : undefined)
    await pullAndClean()
    expect(api.tables.files.get(id(1))?.purged_at).not.toBeNull()
    expect(api.objects.has(path(1))).toBe(true)
    expect(JSON.parse((await db.meta.get(PENDING_REMOVALS_KEY))?.value ?? '[]')).toEqual([path(1)])

    api.failWhen = () => undefined
    clock += HOUSEKEEPING_INTERVAL_MS
    await pullAndClean()
    expect(api.objects.has(path(1))).toBe(false)
    expect(await db.meta.get(PENDING_REMOVALS_KEY)).toBeUndefined()
  })
})

describe('"Șterge definitiv"', () => {
  it('sends local moves to the trash first, purges, removes the objects, pulls the tombstones', async () => {
    api.seed('files', fileRow(1))
    api.seedObject(path(1))
    await pullAndClean()
    await db.files.update(id(1), { deleted_at: new Date(clock).toISOString() })
    await db.outbox.add({
      table: 'files',
      row_id: id(1),
      space_id: SPACE,
      op: 'update',
      payload: { deleted_at: new Date(clock).toISOString() },
      status: 'pending',
      attempts: 0,
      created_at: clock,
      next_attempt_at: 0,
      last_error: null,
    })
    const result = await engine.purge([id(1)])
    expect(result).toMatchObject({ purged: 1, skipped: [], paths: [path(1)] })
    expect(api.objects.has(path(1))).toBe(false)
    expect(await db.files.get(id(1))).toBeUndefined()
  })

  it('in a space of someone else nothing is purged', async () => {
    api.seed('spaces', { id: OTHER, owner_id: 'user-2', name: 'Shared', color: null, emoji: null })
    api.access.push({ id: OTHER, role: 'editor' })
    api.seed('files', {
      ...fileRow(3),
      space_id: OTHER,
      storage_path: path(3, OTHER),
      deleted_at: ago(DAY),
    })
    api.seedObject(path(3, OTHER))
    await pullAndClean()
    const result = await engine.purge([id(3)])
    expect(result).toMatchObject({ purged: 0, skipped: [id(3)], paths: [] })
    expect(api.objects.has(path(3, OTHER))).toBe(true)
  })
})

describe('a file row that waited long checks its object first', () => {
  async function queuedUpload() {
    await engine.pull()
    const [row] = await addFiles(db, USER, SPACE, null, [
      { name: 'Predica', kind: 'audio', mime: 'audio/webm', blob: new Blob(['x']), durationSec: 1 },
    ])
    const fileId = row?.id ?? ''
    // The object went up, then the row could not follow (offline, a folder still unsent…).
    const [entry] = await db.outbox.toArray()
    api.seedObject(`${SPACE}/${fileId}`)
    await db.outbox.update(entry?.seq as number, { uploaded: true, uploaded_at: clock })
    return fileId
  }

  it('the object vanished meanwhile (swept as an orphan): sent again before the row', async () => {
    const fileId = await queuedUpload()
    api.objects.delete(`${SPACE}/${fileId}`)
    clock += OBJECT_RECHECK_MS + DAY
    await engine.push()
    await engine.transfers.run()
    await engine.push()
    expect(api.objects.has(`${SPACE}/${fileId}`)).toBe(true)
    expect(api.tables.files.get(fileId)?.name).toBe('Predica')
    expect(calls('uploadObject')).toHaveLength(1)
  })

  it('a recent confirmation is trusted: no extra request', async () => {
    const fileId = await queuedUpload()
    clock += DAY
    await engine.push()
    expect(calls('objectExists')).toEqual([])
    expect(api.tables.files.get(fileId)).toBeDefined()
  })
})

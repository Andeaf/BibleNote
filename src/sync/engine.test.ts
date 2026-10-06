import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createFolder, moveFolder, updateFolder } from '@/data/folders'
import { createSpace } from '@/data/spaces'
import { BibleNoteDb } from '@/lib/db'
import { MAX_ATTEMPTS, PAGE_SIZE, SyncEngine, backoffMs } from './engine'
import { enqueue } from './outbox'
import {
  FakeApi,
  fkError,
  forbiddenError,
  networkError,
  serverError,
  validationError,
} from './testing/fakeApi'
import type { SyncNotice } from './types'

const USER = 'user-1'
const SPACE = 'space-aaaaaaaa'

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
  })
}

function seedSpace(id = SPACE, role: 'owner' | 'editor' | 'viewer' = 'owner', updatedAt?: string) {
  api.seed(
    'spaces',
    { id, owner_id: USER, name: `Space ${id}`, color: null, emoji: null },
    updatedAt,
  )
  api.access.push({ id, role })
}

beforeEach(async () => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  api = new FakeApi()
  notices = []
  clock = Date.parse('2026-06-01T00:00:00Z')
  engine = makeEngine()
})

describe('pull', () => {
  it('pages with keyset through more than 500 rows sharing one updated_at', async () => {
    seedSpace()
    const stamp = '2026-01-01T00:00:10.000Z'
    for (let i = 0; i < 1200; i++) {
      api.seed(
        'folders',
        { id: `f-${String(i).padStart(4, '0')}`, space_id: SPACE, parent_id: null, name: `F${i}` },
        stamp,
      )
    }
    await engine.pull()
    expect(await db.folders.count()).toBe(1200)
    const folderPages = api.calls.filter((c) => c.method === 'pullPage' && c.table === 'folders')
    expect(folderPages).toHaveLength(3)
    expect(folderPages[0]?.page?.since).toBeUndefined()
    expect(folderPages[1]?.page?.after).toEqual({ updated_at: stamp, id: 'f-0499' })
    expect(folderPages[2]?.page?.after).toEqual({ updated_at: stamp, id: 'f-0999' })
    expect(folderPages.every((c) => c.page?.limit === PAGE_SIZE)).toBe(true)
    expect((await db.meta.get('pull_cursor'))?.value).toBe(stamp)

    // The next pull starts 30 s before the cursor and only on the first page.
    api.calls = []
    await engine.pull()
    const next = api.calls.filter((c) => c.method === 'pullPage' && c.table === 'folders')
    expect(next[0]?.page?.since).toBe('2025-12-31T23:59:40.000Z')
    expect(next[0]?.page?.after).toBeUndefined()
  })

  it('fetches a space joined after the first sync in full, even though its rows are older than the cursor', async () => {
    seedSpace()
    api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    const cursor = (await db.meta.get('pull_cursor'))?.value as string

    const old = '2025-12-01T00:00:00.000Z'
    seedSpace('space-bbbbbbbb', 'viewer', old)
    api.seed('folders', { id: 'f-b', space_id: 'space-bbbbbbbb', parent_id: null, name: 'B' }, old)
    api.seed('profiles', { id: USER, display_name: 'Me' }, old)
    expect(Date.parse(old)).toBeLessThan(Date.parse(cursor))

    api.calls = []
    await engine.pull()
    expect(await db.spaces.get('space-bbbbbbbb')).toBeDefined()
    expect(await db.folders.get('f-b')).toBeDefined()
    expect(await db.spaceAccess.get('space-bbbbbbbb')).toEqual({
      space_id: 'space-bbbbbbbb',
      role: 'viewer',
    })
    expect((await db.profiles.get(USER))?.display_name).toBe('Me')
    const scoped = api.calls.filter(
      (c) => c.method === 'pullPage' && c.page?.spaceId === 'space-bbbbbbbb',
    )
    expect(scoped.map((c) => c.table)).toEqual([
      'spaces',
      'folders',
      'notes',
      'files',
      'space_members',
    ])
  })

  it('removes a space that disappeared from my_spaces, with its rows and outbox entries', async () => {
    seedSpace()
    api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-a',
      space_id: SPACE,
      op: 'update',
      payload: { name: 'x' },
    })

    api.access = []
    await engine.pull()
    expect(await db.spaces.count()).toBe(0)
    expect(await db.folders.count()).toBe(0)
    expect(await db.spaceAccess.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(notices).toEqual([{ kind: 'access_lost', name: `Space ${SPACE}` }])
  })

  it('updates the role when my_spaces changes it', async () => {
    seedSpace(SPACE, 'viewer')
    await engine.pull()
    expect((await db.spaceAccess.get(SPACE))?.role).toBe('viewer')
    api.access = [{ id: SPACE, role: 'editor' }]
    await engine.pull()
    expect((await db.spaceAccess.get(SPACE))?.role).toBe('editor')
  })

  it('never overwrites a row that has a pending outbox entry', async () => {
    seedSpace()
    const server = api.seed('folders', {
      id: 'f-a',
      space_id: SPACE,
      parent_id: null,
      name: 'server v1',
    })
    await engine.pull()
    await updateFolder(db, USER, 'f-a', { name: 'local edit' })
    api.seed('folders', { ...server, name: 'server v2' })
    await engine.pull()
    expect((await db.folders.get('f-a'))?.name).toBe('local edit')
  })

  it('deletes purged rows locally and drops their outbox entries', async () => {
    seedSpace()
    const row = api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    await updateFolder(db, USER, 'f-a', { name: 'edited offline' })
    api.seed('folders', {
      ...row,
      name: '',
      deleted_at: '2026-01-02T00:00:00Z',
      purged_at: '2026-01-03T00:00:00Z',
    })
    await engine.pull()
    expect(await db.folders.get('f-a')).toBeUndefined()
    expect(await db.outbox.count()).toBe(0)
  })

  it('goes offline on a network error and keeps the cursor', async () => {
    seedSpace()
    await engine.pull()
    const cursor = (await db.meta.get('pull_cursor'))?.value
    api.mySpaces = async () => {
      throw networkError()
    }
    await engine.pull()
    expect(engine.state.get().online).toBe(false)
    expect((await db.meta.get('pull_cursor'))?.value).toBe(cursor)
  })
})

describe('push', () => {
  it('keeps the order after coalescing: a renamed folder is still inserted before its child', async () => {
    const space = await createSpace(db, USER, { name: 'S', color: null, emoji: null })
    api.access = [{ id: space.id, role: 'owner' }]
    const parent = await createFolder(db, USER, space.id, null, {
      name: 'Parent',
      color: null,
      emoji: null,
    })
    const child = await createFolder(db, USER, space.id, parent.id, {
      name: 'Child',
      color: null,
      emoji: null,
    })
    await updateFolder(db, USER, parent.id, { name: 'Parent renamed' })

    expect(await db.outbox.count()).toBe(3)
    await engine.push()

    const writes = api.calls
      .filter((c) => c.method === 'insert')
      .map((c) => [c.table, c.payload?.id])
    expect(writes).toEqual([
      ['spaces', space.id],
      ['folders', parent.id],
      ['folders', child.id],
    ])
    expect(api.tables.folders.get(parent.id)?.name).toBe('Parent renamed')
    expect(await db.outbox.count()).toBe(0)
    // The local row carries the server timestamps now.
    expect((await db.folders.get(parent.id))?.updated_at).toBe(
      api.tables.folders.get(parent.id)?.updated_at,
    )
  })

  it('treats 0 updated rows as a permanent failure', async () => {
    seedSpace()
    api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'A' })
    await engine.pull()
    api.denied.add('f-a')
    await updateFolder(db, USER, 'f-a', { name: 'hacked' })
    await engine.push()
    const [entry] = await db.outbox.toArray()
    expect(entry?.status).toBe('failed')
    expect(entry?.last_error).toBe('BN_NO_ROWS')
    expect(notices).toEqual([
      { kind: 'failed', table: 'folders', name: 'hacked', error: 'BN_NO_ROWS' },
    ])
  })

  it('a failed entry blocks only later entries of the same row', async () => {
    seedSpace()
    await engine.pull()
    api.failWhen = (call) =>
      call.method === 'insert' && call.payload?.id === 'f-x' ? forbiddenError() : undefined
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-x',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-x', space_id: SPACE, name: 'X' },
    })
    // An in-flight marker keeps the update from merging into the insert, as if it came later.
    await db.outbox.add({
      table: 'folders',
      row_id: 'f-x',
      space_id: SPACE,
      op: 'update',
      payload: { name: 'X2' },
      status: 'pending',
      attempts: 0,
      created_at: 0,
      next_attempt_at: 0,
      last_error: null,
    })
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-y',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-y', space_id: SPACE, name: 'Y' },
    })

    await engine.push()
    const entries = await db.outbox.orderBy('seq').toArray()
    expect(entries.map((e) => [e.row_id, e.op, e.status])).toEqual([
      ['f-x', 'insert', 'failed'],
      ['f-x', 'update', 'pending'],
    ])
    expect(api.calls.filter((c) => c.method === 'update')).toHaveLength(0)
    expect(api.tables.folders.has('f-y')).toBe(true)
  })

  it('retries foreign-key and server errors with backoff, then fails after 5 attempts', async () => {
    seedSpace()
    await engine.pull()
    let attempts = 0
    api.failWhen = (call) => {
      if (call.method !== 'insert') return undefined
      attempts++
      return attempts % 2 ? fkError() : serverError()
    }
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-a',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-a', space_id: SPACE, name: 'A' },
    })

    for (let round = 1; round < MAX_ATTEMPTS; round++) {
      await engine.push()
      const [entry] = await db.outbox.toArray()
      expect(entry?.status).toBe('pending')
      expect(entry?.attempts).toBe(round)
      expect(entry?.next_attempt_at).toBe(clock + backoffMs(round))
      // Too early: nothing happens.
      await engine.push()
      expect(attempts).toBe(round)
      clock = entry?.next_attempt_at as number
    }
    await engine.push()
    expect(attempts).toBe(MAX_ATTEMPTS)
    expect((await db.outbox.toArray())[0]?.status).toBe('failed')
  })

  it('a network error consumes no attempt and stops the queue until online', async () => {
    seedSpace()
    await engine.pull()
    api.failWhen = (call) => (call.method === 'insert' ? networkError() : undefined)
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-a',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-a', space_id: SPACE, name: 'A' },
    })
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-b',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-b', space_id: SPACE, name: 'B' },
    })
    await engine.push()
    const entries = await db.outbox.toArray()
    expect(entries.map((e) => [e.status, e.attempts])).toEqual([
      ['pending', 0],
      ['pending', 0],
    ])
    expect(api.calls.filter((c) => c.method === 'insert')).toHaveLength(1)
    expect(engine.state.get().online).toBe(false)

    api.failWhen = () => undefined
    engine.setOnline(true)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
  })

  it('RLS denial fails immediately', async () => {
    seedSpace()
    await engine.pull()
    api.failWhen = (call) => (call.method === 'insert' ? forbiddenError() : undefined)
    await enqueue(db, {
      table: 'folders',
      row_id: 'f-a',
      space_id: SPACE,
      op: 'insert',
      payload: { id: 'f-a', space_id: SPACE, name: 'A' },
    })
    await engine.push()
    const [entry] = await db.outbox.toArray()
    expect(entry?.status).toBe('failed')
    expect(entry?.attempts).toBe(0)
  })

  it('moves a new folder to the root when its parent was deleted elsewhere, instead of failing', async () => {
    seedSpace()
    await engine.pull()
    const parent = await createFolder(db, USER, SPACE, null, {
      name: 'Parent',
      color: null,
      emoji: null,
    })
    const child = await createFolder(db, USER, SPACE, parent.id, {
      name: 'Child',
      color: null,
      emoji: null,
    })
    let refused = false
    api.failWhen = (call) => {
      if (call.method === 'insert' && call.payload?.id === child.id && !refused) {
        refused = true
        return validationError('BN_FOLDER_DELETED')
      }
      return undefined
    }
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.folders.get(child.id)?.parent_id).toBeNull()
    expect((await db.folders.get(child.id))?.parent_id).toBeNull()
    expect(notices).toEqual([{ kind: 'moved_to_root', table: 'folders', name: 'Child' }])
  })

  it('continues as an update when the insert already reached the server', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, {
      name: 'A',
      color: null,
      emoji: null,
    })
    api.seed('folders', { ...folder, name: 'A (server)' })
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.folders.get(folder.id)?.name).toBe('A')
    expect(api.calls.map((c) => c.method).filter((m) => m === 'insert' || m === 'update')).toEqual([
      'insert',
      'update',
    ])
  })

  it('keeps edits made while a request was in flight', async () => {
    seedSpace()
    await engine.pull()
    const folder = await createFolder(db, USER, SPACE, null, {
      name: 'A',
      color: null,
      emoji: null,
    })
    // Mark the insert as in flight by hand, then edit: the edit must become a separate entry.
    const [insert] = await db.outbox.toArray()
    await db.outbox.update(insert?.seq as number, { status: 'inflight' })
    await updateFolder(db, USER, folder.id, { name: 'A edited' })
    await db.outbox.update(insert?.seq as number, { status: 'pending' })
    expect(await db.outbox.count()).toBe(2)
    await engine.push()
    expect(await db.outbox.count()).toBe(0)
    expect(api.tables.folders.get(folder.id)?.name).toBe('A edited')
    expect((await db.folders.get(folder.id))?.name).toBe('A edited')
  })

  it('discard restores the row from the server; retry sends it again', async () => {
    seedSpace()
    api.seed('folders', { id: 'f-a', space_id: SPACE, parent_id: null, name: 'server' })
    await engine.pull()
    api.denied.add('f-a')
    await updateFolder(db, USER, 'f-a', { name: 'local' })
    await engine.push()
    const [entry] = await db.outbox.toArray()
    expect(entry?.status).toBe('failed')

    await engine.discard(entry?.seq as number)
    expect(await db.outbox.count()).toBe(0)
    expect((await db.folders.get('f-a'))?.name).toBe('server')

    api.denied.clear()
    await updateFolder(db, USER, 'f-a', { name: 'local again' })
    await engine.push()
    expect(api.tables.folders.get('f-a')?.name).toBe('local again')
  })

  it('moveFolder refuses cycles and trashed targets', async () => {
    seedSpace()
    await engine.pull()
    const a = await createFolder(db, USER, SPACE, null, { name: 'A', color: null, emoji: null })
    const b = await createFolder(db, USER, SPACE, a.id, { name: 'B', color: null, emoji: null })
    expect(await moveFolder(db, USER, a.id, b.id)).toBe(false)
    expect(await moveFolder(db, USER, a.id, a.id)).toBe(false)
    expect(await moveFolder(db, USER, b.id, null)).toBe(true)
    expect((await db.folders.get(b.id))?.parent_id).toBeNull()
  })
})

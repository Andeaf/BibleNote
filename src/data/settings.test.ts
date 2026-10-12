import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appearanceOf } from '@/lib/appearance'
import { BibleNoteDb } from '@/lib/db'
import { SyncEngine } from '@/sync/engine'
import { FakeApi } from '@/sync/testing/fakeApi'
import type { AnyRow } from '@/sync/types'
import { saveSettings } from './settings'

const USER = 'user-1'
let db: BibleNoteDb
let api: FakeApi
let engine: SyncEngine

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  api = new FakeApi()
  api.me = USER
  api.seed('profiles', {
    id: USER,
    display_name: 'Ana',
    settings: { theme: 'light', other: 1 },
    created_at: '2026-01-01T00:00:00Z',
  })
  engine = new SyncEngine({ db, api, userId: USER, setTimer: () => null, clearTimer: () => {} })
})

afterEach(() => {
  engine.dispose()
  db.close()
})

describe('settings follow the account (last write wins)', () => {
  it('saved offline as one entry with the whole object, then sent as settings only', async () => {
    await engine.pull()
    await saveSettings(db, USER, { theme: 'dark' })
    await saveSettings(db, USER, { textSize: 3 })
    const entries = await db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ table: 'profiles', op: 'update', space_id: '' })
    expect((await db.profiles.get(USER))?.settings).toEqual({
      theme: 'dark',
      other: 1,
      textSize: 3,
    })

    await engine.push()
    const update = api.calls.find((c) => c.method === 'update' && c.table === 'profiles')
    expect(update?.payload).toEqual({ settings: { theme: 'dark', other: 1, textSize: 3 } })
    expect(api.tables.profiles.get(USER)?.settings).toEqual({
      theme: 'dark',
      other: 1,
      textSize: 3,
    })
    expect(await db.outbox.count()).toBe(0)
  })

  it('a pull does not undo a change still waiting; a later change elsewhere wins', async () => {
    await engine.pull()
    await saveSettings(db, USER, { theme: 'dark' })
    api.tables.profiles.set(USER, {
      ...(api.tables.profiles.get(USER) as AnyRow),
      settings: { theme: 'light', textSize: 0 },
      updated_at: api.nextTime(),
    })
    await engine.pull()
    expect((await db.profiles.get(USER))?.settings).toMatchObject({ theme: 'dark' })

    await engine.push()
    // Another device chooses again, after this one.
    api.tables.profiles.set(USER, {
      ...(api.tables.profiles.get(USER) as AnyRow),
      settings: { theme: 'auto', textSize: 2 },
      updated_at: api.nextTime(),
    })
    await engine.pull()
    expect((await db.profiles.get(USER))?.settings).toEqual({ theme: 'auto', textSize: 2 })
  })

  it('before the first pull the change waits in a stand-in row', async () => {
    await saveSettings(db, USER, { textSize: 2 })
    expect((await db.profiles.get(USER))?.settings).toEqual({ textSize: 2 })
    await engine.push()
    expect(api.tables.profiles.get(USER)?.settings).toEqual({ textSize: 2 })
  })

  it('only valid values are applied', () => {
    expect(appearanceOf({ theme: 'dark', textSize: 2 })).toEqual({ theme: 'dark', textSize: 2 })
    expect(appearanceOf({ theme: 'purple', textSize: 9 })).toEqual({})
    expect(appearanceOf(null)).toEqual({})
    expect(appearanceOf([1, 2])).toEqual({})
  })
})

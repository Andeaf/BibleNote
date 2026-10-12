import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blobUsage, cacheBlob, clearCache, putPendingBlob, readBlob, releaseBlob } from './blobs'
import { BibleNoteDb } from './db'

let db: BibleNoteDb

const bytes = (n: number) => new Blob([new Uint8Array(n)])

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
})

afterEach(() => {
  db.close()
})

describe('blob cache', () => {
  it('evicts the least recently used cached files, never a file waiting for upload', async () => {
    await putPendingBlob(db, 'pending', 's', bytes(600), 1)
    await cacheBlob(db, 'a', 's', bytes(300), 2, 1000)
    await cacheBlob(db, 'b', 's', bytes(300), 3, 1000)
    await readBlob(db, 'a', 4) // "a" was opened again: "b" is now the oldest
    await cacheBlob(db, 'c', 's', bytes(500), 5, 1000)

    const left = (await db.blobs.toArray()).map((e) => e.file_id).sort()
    expect(left).toEqual(['a', 'c', 'pending'])
    expect(await blobUsage(db)).toEqual({ cachedBytes: 800, pendingBytes: 600, pendingCount: 1 })
  })

  it('a download never replaces the original that is still waiting for upload', async () => {
    await putPendingBlob(db, 'f', 's', bytes(10))
    await cacheBlob(db, 'f', 's', bytes(99))
    expect((await db.blobs.get('f'))?.size).toBe(10)
    expect((await db.blobs.get('f'))?.pending).toBe(1)
  })

  it('"Golește cache-ul" keeps pending uploads; a released upload becomes cache', async () => {
    await putPendingBlob(db, 'up', 's', bytes(10))
    await putPendingBlob(db, 'done', 's', bytes(10))
    await releaseBlob(db, 'done')
    await clearCache(db)
    expect((await db.blobs.toArray()).map((e) => e.file_id)).toEqual(['up'])
  })
})

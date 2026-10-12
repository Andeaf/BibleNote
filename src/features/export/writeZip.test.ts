import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheBlob } from '@/lib/blobs'
import { BibleNoteDb } from '@/lib/db'
import type { StorageProvider } from '@/lib/storage/StorageProvider'
import type { ExportEntry } from './plan'
import { ExportFileError, writeZip } from './writeZip'

const date = new Date('2026-01-01T00:00:00Z')
const entries: ExportEntry[] = [
  { kind: 'note', id: 'n1', path: 'Studiu/Har.md', text: '# Har\n', size: 6, lastModified: date },
  {
    kind: 'file',
    id: 'p1',
    path: 'Studiu/Poza.jpg',
    storagePath: 's/p1',
    size: 6,
    lastModified: date,
  },
  {
    kind: 'file',
    id: 'p2',
    path: 'Studiu/Predica.webm',
    storagePath: 's/p2',
    size: 7,
    lastModified: date,
  },
]

let db: BibleNoteDb
const storage = {
  getUrl: async (path: string) => `https://storage.test/${path}`,
} as unknown as StorageProvider

/** A target that keeps what it is given, as the file picked on disk would. */
function memoryTarget() {
  const chunks: Uint8Array[] = []
  const target = new WritableStream<Uint8Array>({ write: (chunk) => void chunks.push(chunk) })
  const text = () => chunks.map((chunk) => new TextDecoder('latin1').decode(chunk)).join('')
  return { target, text }
}

beforeEach(async () => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  // p1 is on this device; p2 has to be downloaded.
  await cacheBlob(db, 'p1', 's', new Blob(['cached']))
})

afterEach(() => {
  vi.unstubAllGlobals()
  db.close()
})

describe('the ZIP', () => {
  it('is streamed entry by entry: notes, cached files, downloaded files', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response('network')
    })
    const { target, text } = memoryTarget()
    const progress: number[] = []
    await writeZip({
      entries,
      db,
      storage,
      fileName: 'x.zip',
      target,
      preferShare: false,
      signal: new AbortController().signal,
      onProgress: (done) => progress.push(done),
    })
    const zip = text()
    expect(zip.startsWith('PK\u0003\u0004')).toBe(true)
    for (const part of ['Studiu/Har.md', '# Har', 'Studiu/Poza.jpg', 'cached', 'network']) {
      expect(zip).toContain(part)
    }
    expect(fetched).toEqual(['https://storage.test/s/p2'])
    expect(progress).toEqual([1, 2, 3])
  })

  it('stops with the name of a file that cannot be downloaded', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    const { target } = memoryTarget()
    const run = writeZip({
      entries,
      db,
      storage,
      fileName: 'x.zip',
      target,
      preferShare: false,
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })
    await expect(run).rejects.toBeInstanceOf(ExportFileError)
    await expect(run).rejects.toMatchObject({ path: 'Studiu/Predica.webm' })
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', async () => {
      controller.abort()
      return new Response('late')
    })
    const { target } = memoryTarget()
    await expect(
      writeZip({
        entries,
        db,
        storage,
        fileName: 'x.zip',
        target,
        preferShare: false,
        signal: controller.signal,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow()
  })
})

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BibleNoteDb } from '@/lib/db'
import { defaultRecordingName, partFileName, pickRecordingMime } from '@/lib/recording'
import {
  appendChunk,
  discardRecording,
  finishRecording,
  nextPart,
  savePart,
  startRecording,
} from './recordings'

const USER = 'user-1'
const SPACE = 'space-aaaaaaaa'
let db: BibleNoteDb

beforeEach(async () => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  await startRecording(db, {
    id: 'rec-1',
    spaceId: SPACE,
    folderId: 'f-1',
    name: 'Predica',
    mime: 'audio/webm;codecs=opus',
  })
})

afterEach(() => {
  db.close()
})

const chunk = (text: string) => new Blob([text], { type: 'audio/webm' })
const blobText = async (fileId: string | undefined) =>
  (await db.blobs.get(fileId ?? ''))?.blob.text()

describe('recordings', () => {
  it('keeps every chunk as it arrives and saves them, in order, as one queued file', async () => {
    await appendChunk(db, 'rec-1', 1, chunk('aaa'), 5000)
    expect(await appendChunk(db, 'rec-1', 1, chunk('bb'), 10_000)).toBe(5)
    expect(await db.recordingChunks.count()).toBe(2)

    const [file] = await finishRecording(db, USER, 'rec-1', 12_340)
    expect(file).toMatchObject({
      name: 'Predica',
      kind: 'audio',
      mime: 'audio/webm;codecs=opus',
      folder_id: 'f-1',
      size_bytes: 5,
      duration_sec: 12.3,
    })
    expect(await blobText(file?.id)).toBe('aaabb')
    const [entry] = await db.outbox.toArray()
    expect([entry?.table, entry?.op, entry?.row_id]).toEqual(['files', 'upload', file?.id])
    expect(await db.recordings.count()).toBe(0)
    expect(await db.recordingChunks.count()).toBe(0)
  })

  it('splits into parts "Nume – Partea N"; the next part records while the old one closes', async () => {
    await appendChunk(db, 'rec-1', 1, chunk('one'), 60_000)
    expect(await nextPart(db, 'rec-1', 61_000)).toBe(2)
    // The old recorder's last chunk arrives after the new part started.
    await appendChunk(db, 'rec-1', 2, chunk('two'), 65_000)
    expect(await appendChunk(db, 'rec-1', 1, chunk('-end'), 61_000)).toBe(3)
    const first = await savePart(db, USER, 'rec-1', 1, 61)
    await appendChunk(db, 'rec-1', 2, chunk('-more'), 90_000)
    const [second] = await finishRecording(db, USER, 'rec-1', 91_000)

    expect([first?.name, first?.duration_sec]).toEqual(['Predica – Partea 1', 61])
    expect([second?.name, second?.duration_sec]).toEqual(['Predica – Partea 2', 30])
    expect(await blobText(first?.id)).toBe('one-end')
    expect(await blobText(second?.id)).toBe('two-more')
    expect(await db.outbox.count()).toBe(2)
  })

  it('an unfinished recording found at start is saved whole, leftover parts included', async () => {
    await appendChunk(db, 'rec-1', 1, chunk('one'), 60_000)
    await nextPart(db, 'rec-1', 60_000)
    await appendChunk(db, 'rec-1', 2, chunk('two'), 80_000)
    // The app closed before part 1 was saved: both parts are still chunks.
    const rows = await finishRecording(db, USER, 'rec-1')
    expect(rows.map((r) => [r.name, r.duration_sec])).toEqual([
      ['Predica – Partea 1', null],
      ['Predica – Partea 2', 20],
    ])
  })

  it('discard deletes the recording and its chunks; an empty recording makes no file', async () => {
    await appendChunk(db, 'rec-1', 1, chunk('x'), 5000)
    await discardRecording(db, 'rec-1')
    expect(await db.recordings.count()).toBe(0)
    expect(await db.recordingChunks.count()).toBe(0)

    await startRecording(db, { id: 'rec-2', spaceId: SPACE, folderId: null, name: 'G', mime: 'x' })
    expect(await finishRecording(db, USER, 'rec-2')).toEqual([])
    expect(await db.files.count()).toBe(0)
    expect(await db.recordings.count()).toBe(0)
  })

  it('picks WebM/Opus first, MP4 on Safari, and names recordings by date', () => {
    expect(pickRecordingMime(() => true)).toBe('audio/webm;codecs=opus')
    expect(pickRecordingMime((type) => type.startsWith('audio/mp4'))).toBe(
      'audio/mp4;codecs=mp4a.40.2',
    )
    expect(pickRecordingMime(() => false)).toBeNull()
    expect(defaultRecordingName(new Date(2026, 9, 4, 14, 32))).toBe('Înregistrare 2026-10-04 14-32')
    expect(partFileName('X', 1, false)).toBe('X')
    expect(partFileName('X', 1, true)).toBe('X – Partea 1')
  })
})

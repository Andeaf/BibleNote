import type { FileRow } from '@/lib/database.types'
import type { BibleNoteDb, RecordingChunk, RecordingEntry } from '@/lib/db'
import { nowIso } from '@/lib/ids'
import { partFileName } from '@/lib/recording'
import { writeNewFile } from './files'

export interface RecordingStart {
  id: string
  spaceId: string
  folderId: string | null
  name: string
  mime: string
}

/**
 * A recording lives in IndexedDB from its first seconds: the row in `recordings`, every chunk
 * in `recordingChunks` as it arrives. Nothing is lost when the app is closed or the phone dies;
 * on the next start the app offers to save what was recorded.
 */
export async function startRecording(db: BibleNoteDb, input: RecordingStart): Promise<void> {
  await db.recordings.put({
    id: input.id,
    space_id: input.spaceId,
    folder_id: input.folderId,
    name: input.name,
    mime: input.mime,
    part_no: 1,
    part_started_ms: 0,
    elapsed_ms: 0,
    bytes: 0,
    started_at: nowIso(),
    updated_at: Date.now(),
  })
}

/** Stores one chunk of `partNo`; returns the bytes of the current part so far. */
export async function appendChunk(
  db: BibleNoteDb,
  recordingId: string,
  partNo: number,
  data: Blob,
  elapsedMs: number,
): Promise<number> {
  return db.transaction('rw', [db.recordings, db.recordingChunks], async () => {
    const recording = await db.recordings.get(recordingId)
    if (!recording) return 0
    await db.recordingChunks.add({ recording_id: recordingId, part_no: partNo, data })
    const bytes = recording.bytes + (partNo === recording.part_no ? data.size : 0)
    await db.recordings.update(recordingId, {
      bytes,
      elapsed_ms: Math.max(recording.elapsed_ms, elapsedMs),
      updated_at: Date.now(),
    })
    return bytes
  })
}

export async function updateRecording(
  db: BibleNoteDb,
  recordingId: string,
  patch: Partial<Pick<RecordingEntry, 'name' | 'elapsed_ms'>>,
): Promise<void> {
  await db.recordings.update(recordingId, { ...patch, updated_at: Date.now() })
}

/** Split at 45 MB: from now on new chunks belong to the next part. Returns its number. */
export async function nextPart(
  db: BibleNoteDb,
  recordingId: string,
  elapsedMs: number,
): Promise<number> {
  return db.transaction('rw', db.recordings, async () => {
    const recording = await db.recordings.get(recordingId)
    if (!recording) return 0
    const part = recording.part_no + 1
    await db.recordings.update(recordingId, {
      part_no: part,
      part_started_ms: elapsedMs,
      elapsed_ms: Math.max(recording.elapsed_ms, elapsedMs),
      bytes: 0,
      updated_at: Date.now(),
    })
    return part
  })
}

async function writePart(
  db: BibleNoteDb,
  userId: string,
  recording: RecordingEntry,
  chunks: RecordingChunk[],
  part: number,
  split: boolean,
  durationSec: number | null,
): Promise<FileRow | null> {
  const blob = new Blob(
    chunks.filter((c) => c.part_no === part).map((c) => c.data),
    { type: recording.mime },
  )
  if (blob.size === 0) return null
  return writeNewFile(db, userId, recording.space_id, recording.folder_id, {
    name: partFileName(recording.name, part, split),
    kind: 'audio',
    mime: recording.mime,
    blob,
    durationSec: durationSec === null ? null : Math.round(durationSec * 10) / 10,
  })
}

const FILE_TABLES = (db: BibleNoteDb) => [
  db.recordings,
  db.recordingChunks,
  db.files,
  db.blobs,
  db.outbox,
]

/**
 * A finished part of a split recording ("Nume – Partea N") goes into the upload queue as a file;
 * its chunks are removed in the same transaction.
 */
export async function savePart(
  db: BibleNoteDb,
  userId: string,
  recordingId: string,
  part: number,
  durationSec: number | null,
): Promise<FileRow | null> {
  return db.transaction('rw', FILE_TABLES(db), async () => {
    const recording = await db.recordings.get(recordingId)
    if (!recording) return null
    const chunks = await db.recordingChunks.where('recording_id').equals(recordingId).sortBy('id')
    const row = await writePart(db, userId, recording, chunks, part, true, durationSec)
    await db.recordingChunks.bulkDelete(
      chunks.filter((c) => c.part_no === part).map((c) => c.id as number),
    )
    return row
  })
}

/**
 * Ends a recording: every part still in IndexedDB becomes a file (normally just the last one;
 * after a crash during a split, the previous one too), then the recording is removed. Used by
 * "Oprește și salvează" and by "Salvează" on an unfinished recording found at start.
 * The current part's duration comes from the recorded time; an older leftover part has none.
 */
export async function finishRecording(
  db: BibleNoteDb,
  userId: string,
  recordingId: string,
  elapsedMs?: number,
): Promise<FileRow[]> {
  return db.transaction('rw', FILE_TABLES(db), async () => {
    const recording = await db.recordings.get(recordingId)
    if (!recording) return []
    const chunks = await db.recordingChunks.where('recording_id').equals(recordingId).sortBy('id')
    const parts = [...new Set(chunks.map((c) => c.part_no))].sort((a, b) => a - b)
    const split = recording.part_no > 1 || parts.length > 1
    const elapsed = Math.max(recording.elapsed_ms, elapsedMs ?? 0)
    const rows: FileRow[] = []
    for (const part of parts) {
      const duration =
        part === recording.part_no ? (elapsed - recording.part_started_ms) / 1000 : null
      const row = await writePart(db, userId, recording, chunks, part, split, duration)
      if (row) rows.push(row)
    }
    await db.recordingChunks.where('recording_id').equals(recordingId).delete()
    await db.recordings.delete(recordingId)
    return rows
  })
}

/** "Renunță": the recording and its chunks are deleted. Parts already saved stay. */
export async function discardRecording(db: BibleNoteDb, recordingId: string): Promise<void> {
  await db.transaction('rw', [db.recordings, db.recordingChunks], async () => {
    await db.recordingChunks.where('recording_id').equals(recordingId).delete()
    await db.recordings.delete(recordingId)
  })
}

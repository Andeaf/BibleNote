import Dexie, { type EntityTable } from 'dexie'
import type { OutboxEntry } from '@/sync/types'
import type {
  FileRow,
  FolderRow,
  NoteRow,
  ProfileRow,
  SpaceMemberRow,
  SpaceRole,
  SpaceRow,
} from './database.types'

/** The caller's role in a space, as reported by my_spaces() on every pull. */
export interface SpaceAccess {
  space_id: string
  role: SpaceRole
}

export interface MetaEntry {
  key: string
  value: string
}

/**
 * A file's content on this device. `pending = 1`: waiting for upload, kept until the server has
 * confirmed both the object and the row, never evicted. `pending = 0`: offline cache of files
 * opened (or uploaded) recently, evicted least recently used first.
 */
export interface BlobEntry {
  file_id: string
  space_id: string
  blob: Blob
  size: number
  pending: 0 | 1
  last_access_at: number
}

/** An audio recording in progress; its chunks are saved as they arrive (RecordingChunk). */
export interface RecordingEntry {
  id: string
  space_id: string
  folder_id: string | null
  name: string
  mime: string
  /** 1 for the first part; a recording is split into parts before the 50 MB limit. */
  part_no: number
  /** Recorded time (pauses excluded) when the current part started, and up to the last chunk. */
  part_started_ms: number
  elapsed_ms: number
  /** Bytes of the current part. */
  bytes: number
  started_at: string
  updated_at: number
}

export interface RecordingChunk {
  id?: number
  recording_id: string
  /** The part the chunk belongs to: at a split the next part starts before the old one stops. */
  part_no: number
  data: Blob
}

/**
 * The local database: the UI reads and writes only here. One database per account
 * (`biblenote-<user id>`) so accounts on the same browser never mix.
 * Mirrored tables keep the server column names; `members` mirrors `space_members`.
 */
export class BibleNoteDb extends Dexie {
  spaces!: EntityTable<SpaceRow, 'id'>
  folders!: EntityTable<FolderRow, 'id'>
  notes!: EntityTable<NoteRow, 'id'>
  files!: EntityTable<FileRow, 'id'>
  members!: EntityTable<SpaceMemberRow, 'id'>
  profiles!: EntityTable<ProfileRow, 'id'>
  spaceAccess!: EntityTable<SpaceAccess, 'space_id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: EntityTable<MetaEntry, 'key'>
  blobs!: EntityTable<BlobEntry, 'file_id'>
  recordings!: EntityTable<RecordingEntry, 'id'>
  recordingChunks!: EntityTable<RecordingChunk, 'id'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      spaces: 'id, owner_id, updated_at, deleted_at',
      folders: 'id, space_id, parent_id, updated_at, deleted_at',
      notes: 'id, space_id, folder_id, *tags, updated_at, deleted_at',
      files: 'id, space_id, folder_id, kind, updated_at, deleted_at',
      members: 'id, space_id, user_id',
      profiles: 'id',
      spaceAccess: 'space_id',
      outbox: '++seq, [table+row_id], status, space_id',
      meta: 'key',
    })
    // Phase 3: file contents (upload queue + offline cache) and recordings in progress.
    this.version(2).stores({
      blobs: 'file_id, space_id, pending, last_access_at',
      recordings: 'id',
      recordingChunks: '++id, recording_id',
    })
  }
}

export const dbNameFor = (userId: string): string => `biblenote-${userId}`

export function openDb(userId: string): BibleNoteDb {
  return new BibleNoteDb(dbNameFor(userId))
}

/** Wipes the account's local data. Used only by an explicit sign-out on this device. */
export async function deleteDb(userId: string): Promise<void> {
  await Dexie.delete(dbNameFor(userId))
}

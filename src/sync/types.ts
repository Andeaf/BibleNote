import type { SpaceRole } from '@/lib/database.types'

/** Server tables the sync engine pulls. `space_members` is stored locally as `members`. */
export type ServerTable = 'spaces' | 'folders' | 'notes' | 'files' | 'space_members' | 'profiles'

/**
 * Tables the client writes to (note content through the save_note RPC, the rest directly).
 * `profiles`: only the own row's `settings` (theme, text size), never inserted; its entries
 * have no space (`space_id` '').
 */
export type WritableTable = 'spaces' | 'folders' | 'notes' | 'files' | 'profiles'

/**
 * `insert` / `update`: direct writes (for notes `update` is update_note_meta: folder_id, pinned,
 * deleted_at). `save_note`: note content through the RPC, checked against `base_version`.
 * `upload`: a new file: first its Storage object (the blob kept in `blobs`), then its row.
 */
export type OutboxOp = 'insert' | 'update' | 'save_note' | 'upload'
export type OutboxStatus = 'pending' | 'inflight' | 'failed'

/**
 * One pending change. Coalesced on (table, row_id, op): the first entry keeps its seq and only
 * the payload grows, so a folder created before a note stays ahead of it even when renamed later.
 */
export interface OutboxEntry {
  seq?: number
  table: WritableTable
  row_id: string
  space_id: string
  op: OutboxOp
  payload: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  created_at: number
  next_attempt_at: number
  last_error: string | null
  /**
   * save_note only: the server version the content is based on. null = the note does not exist
   * on the server yet; such an entry creates it and follows every insert rule (createsRow).
   */
  base_version?: number | null
  /**
   * upload only: the Storage object is confirmed. Until then the file is transferred by the
   * separate transfer lane and the main queue skips the entry (it still counts as an unsent
   * create); afterwards the main queue inserts the row. The object always exists before the row
   * (docs/PLAN.md §4.6d).
   */
  uploaded?: boolean
  /** upload only: network failures of the transfer in a row while online (the pause ladder). */
  transfer_failures?: number
  /** upload only: the transfer waits until then (engine clock, ms). */
  next_transfer_at?: number
  /**
   * upload only: when the object was last confirmed (engine clock, ms). A row that waited so long
   * that the owner's sweep may have removed the object as an orphan checks it again first.
   */
  uploaded_at?: number
}

/** A Storage object as listed: its path and when it was stored (server time, ISO). */
export interface StoredObject {
  path: string
  createdAt: string
}

/** What purge_items and purge_expired answer (docs/PLAN.md §5.8). */
export interface PurgeResult {
  purged: number
  skipped: string[]
  /** The Storage objects of the file rows purged (directly, or with a folder or a space). */
  paths: string[]
}

/** Progress and cancellation of one file transfer. */
export interface TransferOptions {
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
}

/** The transfer in progress, for the indicator and the file list. */
export interface TransferProgress {
  rowId: string
  loaded: number
  total: number
}

export type AnyRow = Record<string, unknown> & { id: string; updated_at: string }

export type ApiErrorKind =
  | 'network' // no connection: wait for it, attempts are not consumed
  | 'fk' // 23503: a parent is still behind in the queue, retried with backoff
  | 'server' // 5xx, 408, 429: retried with backoff
  | 'auth' // 401 / PGRST301: session refreshed, then retried with backoff
  | 'unique' // 23505 on insert: the row already exists, continue as an update
  | 'forbidden' // 42501: RLS or column privilege, failed immediately
  | 'validation' // P0001 (BN_* codes from triggers and RPCs)
  | 'unknown'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: string | undefined
  readonly status: number | undefined

  constructor(kind: ApiErrorKind, message: string, code?: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.code = code
    this.status = status
  }
}

/** What save_note answers (docs/PLAN.md §3.3). */
export interface SaveNoteResponse {
  status: 'ok' | 'conflict' | 'gone'
  note: AnyRow
}

export interface PullPage {
  /** Restrict to one space (for `spaces` this filters on id). */
  spaceId?: string
  /** First page of an incremental pull: updated_at >= since. */
  since?: string
  /** Following pages: keyset (updated_at, id) > after. */
  after?: { updated_at: string; id: string }
  limit: number
}

/** Everything the engine needs from the backend; implemented over supabase-js and faked in tests. */
export interface SyncApi {
  mySpaces(): Promise<{ id: string; role: SpaceRole }[]>
  pullPage(table: ServerTable, page: PullPage): Promise<AnyRow[]>
  fetchByIds(table: ServerTable, ids: string[]): Promise<AnyRow[]>
  insert(table: WritableTable, payload: Record<string, unknown>): Promise<AnyRow>
  /** Returns the updated rows; an empty array means RLS denied it (never an error). */
  update(table: WritableTable, id: string, payload: Record<string, unknown>): Promise<AnyRow[]>
  /**
   * Stores a file object at its fixed path ('{space_id}/{file_id}'). Throws ApiError 'unique'
   * when the path already holds an object, e.g. our own upload whose answer was lost.
   */
  uploadObject(
    path: string,
    blob: Blob,
    contentType: string,
    options?: TransferOptions,
  ): Promise<void>
  /** Whether the object at `path` still exists. */
  objectExists(path: string): Promise<boolean>
  /** Every object of a space ('{space_id}' prefix), all pages. */
  listObjects(spaceId: string): Promise<StoredObject[]>
  removeObjects(paths: string[]): Promise<void>
  /** The save_note RPC: inserts a new note, or updates the content when the version matches. */
  saveNote(note: Record<string, unknown>, baseVersion: number | null): Promise<SaveNoteResponse>
  /** purge_items: permanent deletion of trashed items, by the owner of their space. */
  purgeItems(ids: string[]): Promise<PurgeResult>
  /** purge_expired: what has been in the caller's own trash for 30 days, chosen by the server. */
  purgeExpired(): Promise<PurgeResult>
  /** The server's clock (ISO), which also dates the Storage objects. */
  serverTime(): Promise<string>
  touchPresence(): Promise<void>
  /** Refreshes the session after a 401 (expired token). */
  refreshAuth(): Promise<void>
}

export type SyncNotice =
  | { kind: 'access_lost'; name: string }
  | { kind: 'moved_to_root'; table: WritableTable; name: string }
  | { kind: 'failed'; table: WritableTable; name: string; error: string }
  /** The note changed elsewhere: the local variant was saved as the new note `copyId`. */
  | { kind: 'conflict'; noteId: string; copyId: string; name: string }
  /** The row was permanently deleted on the server; the local change was dropped. */
  | { kind: 'gone'; table: WritableTable; name: string }
  /** A plain message from the UI (a file refused before upload, a recording saved…). */
  | { kind: 'message'; text: string }

export interface SyncState {
  online: boolean
  pulling: boolean
  pushing: boolean
  lastPullAt: number | null
  lastError: string | null
  /** The file being transferred right now (one at a time), or null. */
  transfer: TransferProgress | null
}

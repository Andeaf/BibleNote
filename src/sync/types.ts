import type { SpaceRole } from '@/lib/database.types'

/** Server tables the sync engine pulls. `space_members` is stored locally as `members`. */
export type ServerTable = 'spaces' | 'folders' | 'notes' | 'files' | 'space_members' | 'profiles'

/** Tables the client writes directly (notes content goes through save_note, phase 2). */
export type WritableTable = 'spaces' | 'folders' | 'notes' | 'files'

export type OutboxOp = 'insert' | 'update'
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
}

export type AnyRow = Record<string, unknown> & { id: string; updated_at: string }

export type ApiErrorKind =
  | 'network' // no connection: wait for it, attempts are not consumed
  | 'fk' // 23503: a parent is still behind in the queue, retried with backoff
  | 'server' // 5xx, retried with backoff
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
  touchPresence(): Promise<void>
}

export type SyncNotice =
  | { kind: 'access_lost'; name: string }
  | { kind: 'moved_to_root'; table: WritableTable; name: string }
  | { kind: 'failed'; table: WritableTable; name: string; error: string }

export interface SyncState {
  online: boolean
  pulling: boolean
  pushing: boolean
  lastPullAt: number | null
  lastError: string | null
}

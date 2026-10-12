import { releaseBlob } from '@/lib/blobs'
import type { NoteRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import {
  INSERT_COLUMNS,
  PARENT_COLUMN,
  SAVE_NOTE_CONTENT_COLUMNS,
  SAVE_NOTE_CREATE_COLUMNS,
  UPDATE_COLUMNS,
  pickColumns,
} from './columns'
import { conflictCopy, conflictKey, localDisplayName } from './conflicts'
import { createsRow, enqueue, outboxKey } from './outbox'
import { createStore, type Store } from './store'
import {
  ApiError,
  type AnyRow,
  type OutboxEntry,
  type PullPage,
  type ServerTable,
  type SyncApi,
  type SyncNotice,
  type SyncState,
  type WritableTable,
} from './types'

export const PAGE_SIZE = 500
export const OVERLAP_MS = 30_000
export const MAX_ATTEMPTS = 5
const PULL_CURSOR_KEY = 'pull_cursor'
const PULLED_TABLES: ServerTable[] = [
  'spaces',
  'folders',
  'notes',
  'files',
  'space_members',
  'profiles',
]
const SPACE_SCOPED: ServerTable[] = ['spaces', 'folders', 'notes', 'files', 'space_members']

export interface EngineDeps {
  db: BibleNoteDb
  api: SyncApi
  userId: string
  now?: () => number
  onNotice?: (notice: SyncNotice) => void
  /** Called after a push cycle with the spaces that changed, to broadcast "pull now". */
  onPushed?: (spaceIds: string[]) => void
  /** Timer used to wake up scheduled retries; injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

type PushOutcome =
  | { type: 'success'; row: AnyRow }
  | { type: 'retry'; error: string }
  | { type: 'network' }
  | { type: 'permanent'; error: string }
  | { type: 'moved_to_root' }
  /** The create already reached the server: continue as an update (of `baseVersion` for notes). */
  | { type: 'convert_to_update'; baseVersion?: number }
  | { type: 'conflict'; row: AnyRow }
  | { type: 'gone' }

export const backoffMs = (attempts: number): number => Math.min(60_000, 1000 * 2 ** (attempts - 1))

const localTableOf = (table: ServerTable) => (table === 'space_members' ? 'members' : table)

/**
 * Local-first sync: the outbox is pushed in order, the server is pulled incrementally.
 * Pure of browser APIs (timers, events, realtime live in runtime.ts) so it can be tested with a
 * fake API and fake-indexeddb. See docs/PLAN.md §4.
 */
export class SyncEngine {
  readonly state: Store<SyncState> = createStore<SyncState>({
    online: true,
    pulling: false,
    pushing: false,
    lastPullAt: null,
    lastError: null,
  })
  private pushPromise: Promise<void> | null = null
  private pushAgain = false
  private pullPromise: Promise<void> | null = null
  private pullAgain = false
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: unknown = null
  /** When the retry timer will fire (engine clock), or null. Exposed for tests. */
  nextRetryAt: number | null = null
  private recovered = false
  private readonly deps: EngineDeps
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer =
      deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  // ---------------------------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------------------------

  setOnline(online: boolean): void {
    this.state.update({ online })
    if (online) {
      void this.pull()
      void this.push()
    }
  }

  /** Debounced push after a local write. */
  requestPush(delayMs = 1000): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.push()
    }, delayMs)
  }

  requestPull(): void {
    void this.pull()
  }

  dispose(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = null
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer)
    this.retryTimer = null
    this.nextRetryAt = null
  }

  /**
   * An entry is marked inflight in IndexedDB before its request. If the app was closed or
   * reloaded during a push, it stays inflight forever and blocks its row. Resending is safe:
   * a duplicate insert answers 23505 and continues as an update; updates are idempotent.
   * Runs once, before the first push of this engine.
   */
  async recoverInflight(): Promise<void> {
    if (this.recovered) return
    this.recovered = true
    await this.deps.db.outbox.where('status').equals('inflight').modify({ status: 'pending' })
  }

  /** Wakes the push loop at the earliest scheduled retry (FK/5xx backoff). */
  private async scheduleRetry(): Promise<void> {
    if (this.retryTimer !== null) this.clearTimer(this.retryTimer)
    this.retryTimer = null
    this.nextRetryAt = null
    const now = this.now()
    let earliest: number | null = null
    await this.deps.db.outbox
      .where('status')
      .equals('pending')
      .each((entry) => {
        if (
          entry.next_attempt_at > now &&
          (earliest === null || entry.next_attempt_at < earliest)
        ) {
          earliest = entry.next_attempt_at
        }
      })
    if (earliest === null) return
    this.nextRetryAt = earliest
    this.retryTimer = this.setTimer(
      () => {
        this.retryTimer = null
        this.nextRetryAt = null
        void this.push()
      },
      Math.max(0, (earliest as number) - now),
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Push
  // ---------------------------------------------------------------------------------------------

  /** Processes the outbox; a call during a run queues one more pass and awaits the whole thing. */
  push(): Promise<void> {
    if (this.pushPromise) {
      this.pushAgain = true
      return this.pushPromise
    }
    this.pushPromise = this.runPush().finally(() => {
      this.pushPromise = null
    })
    return this.pushPromise
  }

  private async runPush(): Promise<void> {
    this.state.update({ pushing: true })
    try {
      await this.recoverInflight()
      do {
        this.pushAgain = false
        await this.processOutbox()
      } while (this.pushAgain)
    } catch (error) {
      this.state.update({ lastError: errorMessage(error) })
    } finally {
      await this.scheduleRetry().catch(() => undefined)
      this.state.update({ pushing: false })
    }
  }

  /**
   * Rows a not-yet-confirmed create (insert, or save_note of a new note) will make: anything that
   * points at them must wait. Failed creates count too: a child of a parent that failed waits
   * until the parent is retried or discarded, instead of failing (or moving to the root) alone.
   */
  private unsentInsertKeys(entries: readonly OutboxEntry[]): Set<string> {
    const keys = new Set<string>()
    for (const entry of entries) {
      if (createsRow(entry)) keys.add(outboxKey(entry.table, entry.row_id))
    }
    return keys
  }

  /** The space and parent folder this entry points at, as outbox keys. */
  private dependenciesOf(entry: OutboxEntry): string[] {
    const deps: string[] = []
    if (entry.table !== 'spaces') deps.push(outboxKey('spaces', entry.space_id))
    const column = PARENT_COLUMN[entry.table]
    const parent = column ? entry.payload[column] : null
    if (typeof parent === 'string') deps.push(outboxKey('folders', parent))
    return deps
  }

  private async processOutbox(): Promise<void> {
    const { db } = this.deps
    const entries = await db.outbox.orderBy('seq').toArray()
    const blocked = new Set<string>()
    const touchedSpaces = new Set<string>()
    const unsentInserts = this.unsentInsertKeys(entries)
    let waitedForParent = false
    let succeeded = false

    for (const snapshot of entries) {
      const key = outboxKey(snapshot.table, snapshot.row_id)
      // Later entries of the same row wait behind a failed, scheduled or in-flight one;
      // other rows are not affected.
      if (blocked.has(key)) continue
      // Read it again: an earlier entry of this pass may have changed it (the base version after
      // a save) or removed it (moved into a conflict copy).
      const entry = await db.outbox.get(snapshot.seq as number)
      if (!entry) continue
      if (entry.status !== 'pending' || entry.next_attempt_at > this.now()) {
        blocked.add(key)
        continue
      }
      // A parent (space or folder) still waiting for its insert: skip this cycle, no attempt used.
      if (this.dependenciesOf(entry).some((dep) => unsentInserts.has(dep))) {
        blocked.add(key)
        waitedForParent = true
        continue
      }
      const seq = entry.seq as number
      await db.outbox.update(seq, { status: 'inflight' })
      const outcome = await this.pushEntry(entry)

      switch (outcome.type) {
        case 'success':
          await this.afterSuccess(entry, outcome.row)
          if (createsRow(entry)) unsentInserts.delete(key)
          touchedSpaces.add(entry.space_id)
          succeeded = true
          this.state.update({ online: true })
          break
        case 'retry': {
          const attempts = entry.attempts + 1
          if (attempts >= MAX_ATTEMPTS) {
            await this.markFailed(entry, outcome.error)
          } else {
            await db.outbox.update(seq, {
              status: 'pending',
              attempts,
              next_attempt_at: this.now() + backoffMs(attempts),
              last_error: outcome.error,
            })
          }
          blocked.add(key)
          break
        }
        case 'network':
          // Attempts are not consumed; everything waits for the connection to come back.
          await db.outbox.update(seq, { status: 'pending' })
          this.state.update({ online: false })
          if (touchedSpaces.size > 0) this.deps.onPushed?.([...touchedSpaces])
          return
        case 'permanent':
          await this.markFailed(entry, outcome.error)
          blocked.add(key)
          break
        case 'moved_to_root':
          // Only when the parent really is gone: a parent whose insert is still in the outbox
          // (for instance created while this push was running) will arrive, so wait for it.
          if (await this.parentInsertPending(entry)) {
            await db.outbox.update(seq, { status: 'pending' })
            waitedForParent = true
          } else {
            await this.moveToRoot(entry)
            this.pushAgain = true
          }
          blocked.add(key)
          break
        case 'convert_to_update':
          await db.transaction('rw', [db.outbox, db.blobs], async () => {
            await db.outbox.update(
              seq,
              entry.op === 'save_note'
                ? { base_version: outcome.baseVersion, status: 'pending' }
                : { op: 'update', status: 'pending' },
            )
            // An upload only gets here after its object was confirmed, and the row exists:
            // both stages are done, the blob is no longer needed for the upload.
            if (entry.op === 'upload') await releaseBlob(db, entry.row_id, this.now())
          })
          unsentInserts.delete(key)
          blocked.add(key)
          this.pushAgain = true
          break
        case 'conflict':
          await this.resolveConflict(entry, outcome.row)
          blocked.add(key)
          // The copy is a new create at the end of the outbox.
          this.pushAgain = true
          break
        case 'gone':
          await this.dropGone(entry)
          blocked.add(key)
          break
      }
    }
    // A parent that reached the server in this cycle unblocks the children skipped before it.
    if (waitedForParent && succeeded) this.pushAgain = true
    if (touchedSpaces.size > 0) this.deps.onPushed?.([...touchedSpaces])
  }

  private async parentInsertPending(entry: OutboxEntry): Promise<boolean> {
    const deps = this.dependenciesOf(entry)
    if (deps.length === 0) return false
    const entries = await this.deps.db.outbox.toArray()
    const unsent = this.unsentInsertKeys(entries)
    return deps.some((dep) => unsent.has(dep))
  }

  private async pushEntry(entry: OutboxEntry): Promise<PushOutcome> {
    const { api } = this.deps
    try {
      if (entry.op === 'save_note') return await this.sendSaveNote(entry)
      if (entry.op === 'upload') return await this.sendUpload(entry)
      if (entry.op === 'insert') {
        const row = await api.insert(
          entry.table,
          pickColumns(entry.payload, INSERT_COLUMNS[entry.table]),
        )
        return { type: 'success', row }
      }
      const rows = await api.update(
        entry.table,
        entry.row_id,
        pickColumns(entry.payload, UPDATE_COLUMNS[entry.table]),
      )
      // RLS never answers 401/403 for an update: 0 rows is the denial.
      if (rows.length === 0) return { type: 'permanent', error: 'BN_NO_ROWS' }
      return { type: 'success', row: rows[0] as AnyRow }
    } catch (error) {
      if (!(error instanceof ApiError)) return { type: 'permanent', error: errorMessage(error) }
      switch (error.kind) {
        case 'network':
          return { type: 'network' }
        case 'fk':
        case 'server':
          return { type: 'retry', error: error.message }
        case 'auth':
          // Expired token (401 / PGRST301): refresh the session, then retry with backoff.
          await api.refreshAuth().catch(() => undefined)
          return { type: 'retry', error: error.message }
        case 'unique':
          // The row already exists: our own insert, whose answer was lost.
          return entry.op === 'insert' || entry.op === 'upload'
            ? { type: 'convert_to_update' }
            : { type: 'permanent', error: error.message }
        case 'validation':
          // Creates only (inserts and new notes); a refused move stays failed (§2, rev. 3).
          if (
            createsRow(entry) &&
            PARENT_COLUMN[entry.table] &&
            /BN_FOLDER_DELETED|BN_FOLDER_NOT_IN_SPACE/.test(error.message)
          ) {
            return { type: 'moved_to_root' }
          }
          return { type: 'permanent', error: error.message }
        default:
          return { type: 'permanent', error: error.message }
      }
    }
  }

  /**
   * A new file, in two stages (docs/PLAN.md §4.6d): first the Storage object, then the row, so
   * no device ever sees a row whose file does not exist yet. The path is fixed
   * ('{space_id}/{file_id}'): an object already there is our own earlier upload whose answer was
   * lost, so "already exists" counts as success. Once the object is confirmed the entry
   * remembers it, and a retry (network, 5xx, a lost answer) only inserts the row. Errors of
   * either stage are classified like any other request by the caller.
   */
  private async sendUpload(entry: OutboxEntry): Promise<PushOutcome> {
    const { db, api } = this.deps
    if (!entry.uploaded) {
      const stored = await db.blobs.get(entry.row_id)
      if (!stored) return { type: 'permanent', error: 'BN_BLOB_MISSING' }
      const path = String(entry.payload.storage_path)
      const mime = String(entry.payload.mime || stored.blob.type || 'application/octet-stream')
      try {
        await api.uploadObject(path, stored.blob, mime)
      } catch (error) {
        if (!(error instanceof ApiError && error.kind === 'unique')) throw error
      }
      await db.outbox.update(entry.seq as number, { uploaded: true })
    }
    const row = await api.insert('files', pickColumns(entry.payload, INSERT_COLUMNS.files))
    return { type: 'success', row }
  }

  /**
   * save_note through the RPC. A new note sends the whole row and no base version; an existing
   * one only its content, checked against the version it was based on.
   */
  private async sendSaveNote(entry: OutboxEntry): Promise<PushOutcome> {
    const create = createsRow(entry)
    const note = {
      ...pickColumns(entry.payload, create ? SAVE_NOTE_CREATE_COLUMNS : SAVE_NOTE_CONTENT_COLUMNS),
      id: entry.row_id,
      space_id: entry.space_id,
    }
    const result = await this.deps.api.saveNote(note, create ? null : (entry.base_version ?? null))
    switch (result.status) {
      case 'ok':
        return { type: 'success', row: result.note }
      case 'gone':
        return { type: 'gone' }
      case 'conflict':
        // A create sent again after its answer was lost (or after a reload left it in flight),
        // with edits merged in since. The row is our own insert, untouched since: version 1 and
        // created by me (the id was generated on this device). Like a 23505 on an insert, it
        // continues as an update of that version instead of becoming a conflict copy.
        if (create && result.note.version === 1 && result.note.created_by === this.deps.userId) {
          return { type: 'convert_to_update', baseVersion: 1 }
        }
        return { type: 'conflict', row: result.note }
    }
  }

  private rowEntries(entry: OutboxEntry): Promise<OutboxEntry[]> {
    return this.deps.db.outbox
      .where('[table+row_id]')
      .equals([entry.table, entry.row_id])
      .sortBy('seq')
  }

  private async afterSuccess(entry: OutboxEntry, row: AnyRow): Promise<void> {
    const { db } = this.deps
    const table = db.table(entry.table)
    await db.transaction('rw', [table, db.outbox, db.blobs], async () => {
      await db.outbox.delete(entry.seq as number)
      // Object and row confirmed: the blob stays only as an evictable cache entry.
      if (entry.op === 'upload') await releaseBlob(db, entry.row_id, this.now())
      // Edits made while the request was in flight sit in later entries: keep them on top.
      const later = await this.rowEntries(entry)
      if (entry.op === 'save_note') {
        // They were written on top of this content, so they continue from its new version.
        for (const next of later) {
          if (next.op === 'save_note') {
            await db.outbox.update(next.seq as number, { base_version: row.version as number })
          }
        }
      }
      const local = Object.assign({}, row, ...later.map((e) => e.payload)) as AnyRow
      await table.put(local)
    })
  }

  /**
   * The note changed on the server since this device's base version (docs/PLAN.md §4.5).
   * Nothing is overwritten: the original takes the server version (with metadata changes still
   * queued on top), and the local variant, including edits queued behind this entry, becomes a
   * new note "Titlu (conflict – Nume, dată)" in the same folder. The copy is a create like any
   * other: it waits for its folder, moves to the root if the folder is gone.
   */
  private async resolveConflict(entry: OutboxEntry, server: AnyRow): Promise<void> {
    const { db, userId } = this.deps
    const name = await localDisplayName(db, userId, entry.space_id)
    const at = new Date(this.now())
    let copy: NoteRow | undefined
    await db.transaction('rw', [db.notes, db.outbox, db.meta], async () => {
      const later = (await this.rowEntries(entry)).filter((e) => e.seq !== entry.seq)
      const laterSaves = later.filter((e) => e.op === 'save_note')
      const laterMeta = later.filter((e) => e.op !== 'save_note')
      const local = await db.notes.get(entry.row_id)
      const variant =
        local ??
        (Object.assign({}, server, entry.payload, ...laterSaves.map((e) => e.payload)) as NoteRow)
      copy = conflictCopy(variant, userId, name, at)
      await db.notes.put(copy)
      await enqueue(
        db,
        {
          table: 'notes',
          row_id: copy.id,
          space_id: copy.space_id,
          op: 'save_note',
          base_version: null,
          payload: pickColumns(copy, SAVE_NOTE_CREATE_COLUMNS),
        },
        this.now(),
      )
      await db.notes.put(Object.assign({}, server, ...laterMeta.map((e) => e.payload)) as NoteRow)
      await db.outbox.bulkDelete([entry, ...laterSaves].map((e) => e.seq as number))
      // An editor still open on the original sends its last keystrokes to the copy.
      await db.meta.put({ key: conflictKey(entry.row_id), value: copy.id })
    })
    if (copy) {
      this.deps.onNotice?.({
        kind: 'conflict',
        noteId: entry.row_id,
        copyId: copy.id,
        name: copy.title,
      })
    }
  }

  /** save_note answered `gone`: the note was purged, so it and its queued changes go. */
  private async dropGone(entry: OutboxEntry): Promise<void> {
    const { db } = this.deps
    const name = await this.rowName(entry.table, entry.row_id)
    const table = db.table(entry.table)
    await db.transaction('rw', [table, db.outbox], async () => {
      await table.delete(entry.row_id)
      await db.outbox.where('[table+row_id]').equals([entry.table, entry.row_id]).delete()
    })
    this.deps.onNotice?.({ kind: 'gone', table: entry.table, name })
  }

  private async markFailed(entry: OutboxEntry, error: string): Promise<void> {
    await this.deps.db.outbox.update(entry.seq as number, { status: 'failed', last_error: error })
    this.deps.onNotice?.({
      kind: 'failed',
      table: entry.table,
      name: await this.rowName(entry.table, entry.row_id),
      error,
    })
  }

  /**
   * The parent folder was deleted on another device while this item was created offline.
   * The item is kept and moved to the root of its space instead of being marked failed,
   * because "discard" would lose something new (docs/PLAN.md §4.2, rev. 4).
   */
  private async moveToRoot(entry: OutboxEntry): Promise<void> {
    const { db } = this.deps
    const column = PARENT_COLUMN[entry.table] as string
    const table = db.table(entry.table)
    await db.transaction('rw', [table, db.outbox], async () => {
      await db.outbox.update(entry.seq as number, {
        payload: { ...entry.payload, [column]: null },
        status: 'pending',
        last_error: null,
      })
      await table.update(entry.row_id, { [column]: null })
    })
    this.deps.onNotice?.({
      kind: 'moved_to_root',
      table: entry.table,
      name: await this.rowName(entry.table, entry.row_id),
    })
  }

  private async rowName(table: WritableTable, id: string): Promise<string> {
    const row = (await this.deps.db.table(table).get(id)) as
      { name?: string; title?: string } | undefined
    return row?.name ?? row?.title ?? ''
  }

  // ---------------------------------------------------------------------------------------------
  // Failed entries: retry or discard (restore the row from the server)
  // ---------------------------------------------------------------------------------------------

  async retry(seq: number): Promise<void> {
    await this.deps.db.outbox.update(seq, {
      status: 'pending',
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
    })
    await this.push()
  }

  /**
   * Gives up the local changes of the entry's row: every queued change of that row goes and the
   * row becomes the server's version again (or disappears if the server never had it). The
   * server is asked first, so offline this throws and nothing changes.
   */
  async discard(seq: number): Promise<void> {
    const { db, api } = this.deps
    const entry = await db.outbox.get(seq)
    if (!entry) return
    const rows = await api.fetchByIds(entry.table, [entry.row_id])
    const server = rows[0]
    const table = db.table(entry.table)
    await db.transaction('rw', [table, db.outbox, db.spaceAccess, db.blobs], async () => {
      await db.outbox.where('[table+row_id]').equals([entry.table, entry.row_id]).delete()
      if (server && !server.purged_at) {
        await table.put(server)
        // The server has the file: its local copy is now only a cache entry.
        if (entry.table === 'files') await releaseBlob(db, entry.row_id, this.now())
      } else {
        await table.delete(entry.row_id)
        if (entry.table === 'spaces') await db.spaceAccess.delete(entry.row_id)
        // A file the server never got: its content goes with it. An object uploaded without
        // its row is removed by the owner's orphan sweep (docs/PLAN.md §5.8).
        if (entry.table === 'files') await db.blobs.delete(entry.row_id)
      }
    })
  }

  // ---------------------------------------------------------------------------------------------
  // Pull
  // ---------------------------------------------------------------------------------------------

  /** Pulls from the server; a call during a run queues one more pass and awaits the whole thing. */
  pull(): Promise<void> {
    if (this.pullPromise) {
      this.pullAgain = true
      return this.pullPromise
    }
    this.pullPromise = this.runPull().finally(() => {
      this.pullPromise = null
    })
    return this.pullPromise
  }

  private async runPull(): Promise<void> {
    this.state.update({ pulling: true })
    try {
      do {
        this.pullAgain = false
        await this.pullOnce()
      } while (this.pullAgain)
      this.state.update({ online: true, lastPullAt: this.now(), lastError: null })
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'network') {
        this.state.update({ online: false })
      } else if (error instanceof ApiError && error.kind === 'auth') {
        // Expired token: refresh now; the next trigger (timer, focus, realtime) pulls again.
        await this.deps.api.refreshAuth().catch(() => undefined)
        this.state.update({ lastError: errorMessage(error) })
      } else {
        this.state.update({ lastError: errorMessage(error) })
      }
    } finally {
      this.state.update({ pulling: false })
    }
  }

  private async pullOnce(): Promise<void> {
    const { db, api } = this.deps
    const access = await api.mySpaces()
    const cursor = (await db.meta.get(PULL_CURSOR_KEY))?.value ?? null
    const local = await db.spaceAccess.toArray()
    const accessIds = new Set(access.map((a) => a.id))
    const localIds = new Set(local.map((l) => l.space_id))

    for (const entry of local) {
      if (accessIds.has(entry.space_id)) continue
      // Only spaces where I am a member are dropped on the strength of my_spaces(). My own
      // spaces disappear only through their purged_at tombstone: a space created offline is
      // missing from my_spaces() until its insert reaches the server, and must survive that.
      const space = await db.spaces.get(entry.space_id)
      const mine = space ? space.owner_id === this.deps.userId : entry.role === 'owner'
      if (!mine) await this.removeSpaceLocally(entry.space_id, true)
    }
    for (const entry of access) {
      await db.spaceAccess.put({ space_id: entry.id, role: entry.role })
      // A space joined after the first sync has rows older than the cursor: fetch it whole.
      // Without a cursor the incremental pull below fetches everything anyway.
      if (cursor && !localIds.has(entry.id)) await this.pullSpaceFull(entry.id)
    }
    await this.pullIncremental(cursor)
  }

  private async pullSpaceFull(spaceId: string): Promise<void> {
    for (const table of SPACE_SCOPED) {
      await this.pullPages(table, { spaceId })
    }
    const space = await this.deps.db.spaces.get(spaceId)
    if (space) {
      const owners = await this.deps.api.fetchByIds('profiles', [space.owner_id])
      await this.applyRows('profiles', owners)
    }
  }

  private async pullIncremental(cursor: string | null): Promise<void> {
    const since = cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : undefined
    let max: string | null = null
    for (const table of PULLED_TABLES) {
      const tableMax = await this.pullPages(table, since ? { since } : {})
      if (tableMax && (!max || Date.parse(tableMax) > Date.parse(max))) max = tableMax
    }
    // Saved once, at the end: an interrupted pull simply starts again from the old cursor.
    if (max) await this.deps.db.meta.put({ key: PULL_CURSOR_KEY, value: max })
  }

  /** Pages through one table and applies every row; returns the largest updated_at seen. */
  private async pullPages(
    table: ServerTable,
    scope: { spaceId?: string; since?: string },
  ): Promise<string | null> {
    let after: PullPage['after'] = undefined
    let max: string | null = null
    for (;;) {
      const page: PullPage = { limit: PAGE_SIZE, spaceId: scope.spaceId }
      // The 30 s overlap applies to the first page only; the rest is keyset, otherwise more
      // than 500 rows sharing one updated_at (a purged folder) would loop forever.
      if (after) page.after = after
      else if (scope.since) page.since = scope.since
      const rows = await this.deps.api.pullPage(table, page)
      if (rows.length === 0) break
      await this.applyRows(table, rows)
      const last = rows[rows.length - 1] as AnyRow
      if (!max || Date.parse(last.updated_at) > Date.parse(max)) max = last.updated_at
      if (rows.length < PAGE_SIZE) break
      after = { updated_at: last.updated_at, id: last.id }
    }
    return max
  }

  private async applyRows(table: ServerTable, rows: AnyRow[]): Promise<void> {
    const { db } = this.deps
    const local = db.table(localTableOf(table))
    const pending = new Set((await db.outbox.toArray()).map((e) => outboxKey(e.table, e.row_id)))
    const reachable = new Set((await db.spaceAccess.toArray()).map((a) => a.space_id))
    for (const row of rows) {
      if (table === 'spaces' && row.purged_at) {
        await this.removeSpaceLocally(row.id, false)
        reachable.delete(row.id)
        continue
      }
      // Rows of a space that is not (or no longer) reachable here are ignored, e.g. the
      // contents of a space whose tombstone arrived earlier in this pull.
      if (table !== 'profiles') {
        const spaceId = String(table === 'spaces' ? row.id : row.space_id)
        if (!reachable.has(spaceId)) continue
      }
      if (row.purged_at) {
        await db.transaction('rw', [local, db.outbox, db.blobs], async () => {
          await local.delete(row.id)
          await db.outbox.where('[table+row_id]').equals([table, row.id]).delete()
          if (table === 'files') await db.blobs.delete(row.id)
        })
        continue
      }
      // Never overwrite a row with local changes still in the outbox; push resolves it.
      if (pending.has(outboxKey(table, row.id))) continue
      await local.put(row)
    }
  }

  /** Access was lost (or the space was purged): drop everything of that space on this device. */
  private async removeSpaceLocally(spaceId: string, notify: boolean): Promise<void> {
    const { db } = this.deps
    const space = await db.spaces.get(spaceId)
    await db.transaction(
      'rw',
      [db.spaces, db.folders, db.notes, db.files, db.members, db.spaceAccess, db.outbox, db.blobs],
      async () => {
        await db.spaces.delete(spaceId)
        for (const table of [db.folders, db.notes, db.files, db.members, db.blobs]) {
          await table.where('space_id').equals(spaceId).delete()
        }
        await db.spaceAccess.delete(spaceId)
        await db.outbox.where('space_id').equals(spaceId).delete()
      },
    )
    if (notify && space) this.deps.onNotice?.({ kind: 'access_lost', name: space.name })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

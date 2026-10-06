import type { BibleNoteDb } from '@/lib/db'
import { INSERT_COLUMNS, PARENT_COLUMN, UPDATE_COLUMNS, pickColumns } from './columns'
import { outboxKey } from './outbox'
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
}

type PushOutcome =
  | { type: 'success'; row: AnyRow }
  | { type: 'retry'; error: string }
  | { type: 'network' }
  | { type: 'permanent'; error: string }
  | { type: 'moved_to_root' }
  | { type: 'convert_to_update' }

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
  private readonly deps: EngineDeps
  private readonly now: () => number

  constructor(deps: EngineDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
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
      do {
        this.pushAgain = false
        await this.processOutbox()
      } while (this.pushAgain)
    } catch (error) {
      this.state.update({ lastError: errorMessage(error) })
    } finally {
      this.state.update({ pushing: false })
    }
  }

  private async processOutbox(): Promise<void> {
    const { db } = this.deps
    const entries = await db.outbox.orderBy('seq').toArray()
    const blocked = new Set<string>()
    const touchedSpaces = new Set<string>()

    for (const entry of entries) {
      const key = outboxKey(entry.table, entry.row_id)
      // Later entries of the same row wait behind a failed, scheduled or in-flight one;
      // other rows are not affected.
      if (blocked.has(key)) continue
      if (entry.status !== 'pending' || entry.next_attempt_at > this.now()) {
        blocked.add(key)
        continue
      }
      const seq = entry.seq as number
      await db.outbox.update(seq, { status: 'inflight' })
      const outcome = await this.pushEntry(entry)

      switch (outcome.type) {
        case 'success':
          await this.afterSuccess(entry, outcome.row)
          touchedSpaces.add(entry.space_id)
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
          await this.moveToRoot(entry)
          blocked.add(key)
          this.pushAgain = true
          break
        case 'convert_to_update':
          await db.outbox.update(seq, { op: 'update', status: 'pending' })
          blocked.add(key)
          this.pushAgain = true
          break
      }
    }
    if (touchedSpaces.size > 0) this.deps.onPushed?.([...touchedSpaces])
  }

  private async pushEntry(entry: OutboxEntry): Promise<PushOutcome> {
    const { api } = this.deps
    try {
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
        case 'unique':
          return entry.op === 'insert'
            ? { type: 'convert_to_update' }
            : { type: 'permanent', error: error.message }
        case 'validation':
          if (
            entry.op === 'insert' &&
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

  private async afterSuccess(entry: OutboxEntry, row: AnyRow): Promise<void> {
    const { db } = this.deps
    const table = db.table(entry.table)
    await db.transaction('rw', [table, db.outbox], async () => {
      await db.outbox.delete(entry.seq as number)
      // Edits made while the request was in flight sit in later entries: keep them on top.
      const later = await db.outbox
        .where('[table+row_id]')
        .equals([entry.table, entry.row_id])
        .toArray()
      const local = Object.assign({}, row, ...later.map((e) => e.payload)) as AnyRow
      await table.put(local)
    })
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

  async discard(seq: number): Promise<void> {
    const { db, api } = this.deps
    const entry = await db.outbox.get(seq)
    if (!entry) return
    await db.outbox.delete(seq)
    const table = db.table(entry.table)
    const rows = await api.fetchByIds(entry.table, [entry.row_id])
    const server = rows[0]
    if (server && !server.purged_at) await table.put(server)
    else await table.delete(entry.row_id)
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
      if (!accessIds.has(entry.space_id)) await this.removeSpaceLocally(entry.space_id, true)
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
    for (const row of rows) {
      if (table === 'spaces' && row.purged_at) {
        await this.removeSpaceLocally(row.id, false)
        continue
      }
      if (row.purged_at) {
        await db.transaction('rw', [local, db.outbox], async () => {
          await local.delete(row.id)
          await db.outbox.where('[table+row_id]').equals([table, row.id]).delete()
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
      [db.spaces, db.folders, db.notes, db.files, db.members, db.spaceAccess, db.outbox],
      async () => {
        await db.spaces.delete(spaceId)
        for (const table of [db.folders, db.notes, db.files, db.members]) {
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

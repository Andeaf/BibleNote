import type { SpaceRole } from '@/lib/database.types'
import {
  ApiError,
  type AnyRow,
  type PullPage,
  type ServerTable,
  type SyncApi,
  type WritableTable,
} from '../types'

export interface FakeCall {
  method: 'mySpaces' | 'pullPage' | 'fetchByIds' | 'insert' | 'update' | 'touchPresence'
  table?: string
  page?: PullPage
  id?: string
  payload?: Record<string, unknown>
}

/**
 * In-memory stand-in for the backend with PostgREST-like semantics: server-owned timestamps,
 * keyset paging, 0 rows for denied updates, and programmable failures.
 */
export class FakeApi implements SyncApi {
  readonly tables: Record<ServerTable, Map<string, AnyRow>> = {
    spaces: new Map(),
    folders: new Map(),
    notes: new Map(),
    files: new Map(),
    space_members: new Map(),
    profiles: new Map(),
  }
  access: { id: string; role: SpaceRole }[] = []
  calls: FakeCall[] = []
  /** Ids whose updates are denied by "RLS" (0 rows). */
  denied = new Set<string>()
  /** Consulted before every insert/update; return an error to throw it. */
  failWhen: (call: FakeCall) => ApiError | undefined = () => undefined
  private clock = Date.parse('2026-01-01T00:00:00.000Z')

  /** Server time advances one second per write, so ordering is deterministic. */
  nextTime(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  seed(
    table: ServerTable,
    row: Record<string, unknown> & { id: string },
    updatedAt?: string,
  ): AnyRow {
    const full = {
      deleted_at: null,
      purged_at: null,
      ...row,
      updated_at: updatedAt ?? this.nextTime(),
    } as AnyRow
    this.tables[table].set(full.id, full)
    return full
  }

  async mySpaces() {
    this.calls.push({ method: 'mySpaces' })
    return this.access.map((a) => ({ ...a }))
  }

  /** Like RLS: only rows of accessible spaces are visible (profiles are not space-scoped). */
  private visible(table: ServerTable): AnyRow[] {
    const rows = [...this.tables[table].values()]
    if (table === 'profiles') return rows
    const accessible = new Set(this.access.map((a) => a.id))
    return rows.filter((r) => accessible.has(String(table === 'spaces' ? r.id : r.space_id)))
  }

  async pullPage(table: ServerTable, page: PullPage): Promise<AnyRow[]> {
    this.calls.push({ method: 'pullPage', table, page })
    let rows = this.visible(table)
    if (page.spaceId) {
      rows = rows.filter((r) => (table === 'spaces' ? r.id : r.space_id) === page.spaceId)
    }
    if (page.after) {
      const { updated_at, id } = page.after
      rows = rows.filter(
        (r) =>
          Date.parse(r.updated_at) > Date.parse(updated_at) ||
          (r.updated_at === updated_at && r.id > id),
      )
    } else if (page.since) {
      rows = rows.filter((r) => Date.parse(r.updated_at) >= Date.parse(page.since as string))
    }
    rows.sort(
      (a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || (a.id < b.id ? -1 : 1),
    )
    return rows.slice(0, page.limit).map((r) => ({ ...r }))
  }

  async fetchByIds(table: ServerTable, ids: string[]): Promise<AnyRow[]> {
    this.calls.push({ method: 'fetchByIds', table })
    return ids.map((id) => this.tables[table].get(id)).filter((r): r is AnyRow => !!r)
  }

  async insert(table: WritableTable, payload: Record<string, unknown>): Promise<AnyRow> {
    const call: FakeCall = { method: 'insert', table, payload }
    this.calls.push(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    const id = payload.id as string
    if (this.tables[table].has(id)) {
      throw new ApiError('unique', 'duplicate key value violates unique constraint', '23505', 409)
    }
    const time = this.nextTime()
    const row = {
      deleted_at: null,
      purged_at: null,
      ...payload,
      created_at: time,
      updated_at: time,
    } as unknown as AnyRow
    this.tables[table].set(id, row)
    return { ...row }
  }

  async update(
    table: WritableTable,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<AnyRow[]> {
    const call: FakeCall = { method: 'update', table, id, payload }
    this.calls.push(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    const existing = this.tables[table].get(id)
    if (!existing || this.denied.has(id) || existing.purged_at) return []
    const row = { ...existing, ...payload, updated_at: this.nextTime() } as AnyRow
    this.tables[table].set(id, row)
    return [{ ...row }]
  }

  async touchPresence(): Promise<void> {
    this.calls.push({ method: 'touchPresence' })
  }
}

export const networkError = () => new ApiError('network', 'TypeError: Failed to fetch')
export const fkError = () =>
  new ApiError('fk', 'insert or update violates foreign key constraint', '23503', 409)
export const serverError = () => new ApiError('server', 'internal error', 'PGRST000', 503)
export const forbiddenError = () =>
  new ApiError('forbidden', 'new row violates row-level security policy', '42501', 403)
export const validationError = (code: string) => new ApiError('validation', code, 'P0001', 400)

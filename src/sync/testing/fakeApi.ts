import type { SpaceRole } from '@/lib/database.types'
import { jsonEqual } from '@/lib/jsonEqual'
import {
  ApiError,
  type AnyRow,
  type PullPage,
  type SaveNoteResponse,
  type ServerTable,
  type SyncApi,
  type WritableTable,
} from '../types'

export interface FakeCall {
  method:
    | 'mySpaces'
    | 'pullPage'
    | 'fetchByIds'
    | 'insert'
    | 'update'
    | 'saveNote'
    | 'touchPresence'
    | 'refreshAuth'
  table?: string
  page?: PullPage
  id?: string
  payload?: Record<string, unknown>
  baseVersion?: number | null
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
  /** The signed-in user, for owner visibility of purged spaces. */
  me: string | null = null
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
    // The owner keeps seeing their spaces (and contents) after purge, as RLS allows.
    for (const space of this.tables.spaces.values()) {
      if (this.me && space.owner_id === this.me) accessible.add(space.id)
    }
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
    // No INSERT grant on notes: they are created through save_note only.
    if (table === 'notes') throw forbiddenError()
    this.validate(table, payload)
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
    this.validate(table, payload, existing)
    const row = { ...existing, ...payload, updated_at: this.nextTime() } as AnyRow
    this.tables[table].set(id, row)
    return [{ ...row }]
  }

  /**
   * save_note as in migration ..._rpc.sql: access first, insert when missing (folder checked by
   * the trigger), `gone` for purged rows, `ok` for identical content whatever the version,
   * `conflict` when the version moved (or no base version), else an update of the content only.
   */
  async saveNote(note: Record<string, unknown>, baseVersion: number | null) {
    const call: FakeCall = {
      method: 'saveNote',
      table: 'notes',
      id: String(note.id),
      payload: note,
    }
    call.baseVersion = baseVersion
    this.calls.push(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    const id = String(note.id)
    const title = typeof note.title === 'string' ? note.title : ''
    const content = note.content && typeof note.content === 'object' ? note.content : {}
    const tags = Array.isArray(note.tags) ? note.tags : []
    const existing = this.tables.notes.get(id)
    const reply = (status: SaveNoteResponse['status'], row: AnyRow): SaveNoteResponse => ({
      status,
      note: { ...row },
    })

    if (!existing) {
      const spaceId = String(note.space_id)
      if (!this.canEdit(spaceId)) throw forbiddenError()
      this.validate('notes', { space_id: spaceId, folder_id: note.folder_id ?? null })
      const time = this.nextTime()
      const row = {
        id,
        space_id: spaceId,
        folder_id: note.folder_id ?? null,
        title,
        content,
        content_text: typeof note.content_text === 'string' ? note.content_text : '',
        tags,
        pinned: note.pinned === true,
        version: 1,
        created_by: this.me,
        updated_by: this.me,
        created_at: time,
        updated_at: time,
        deleted_at: note.deleted_at ?? null,
        purged_at: null,
      } as AnyRow
      this.tables.notes.set(id, row)
      return reply('ok', row)
    }
    if (!this.canEdit(String(existing.space_id))) throw forbiddenError()
    if (existing.purged_at) return reply('gone', existing)
    if (
      existing.title === title &&
      jsonEqual(existing.content, content) &&
      jsonEqual(existing.tags, tags)
    ) {
      return reply('ok', existing)
    }
    if (baseVersion === null || existing.version !== baseVersion) {
      return reply('conflict', existing)
    }
    const row = {
      ...existing,
      title,
      content,
      content_text: typeof note.content_text === 'string' ? note.content_text : '',
      tags,
      version: (existing.version as number) + 1,
      updated_by: this.me,
      updated_at: this.nextTime(),
    } as AnyRow
    this.tables.notes.set(id, row)
    return reply('ok', row)
  }

  /** Another device saves a note: version + 1, like a successful save_note. */
  editNote(id: string, changes: Record<string, unknown>, by = 'user-other'): AnyRow {
    const existing = this.tables.notes.get(id) as AnyRow
    const row = {
      ...existing,
      ...changes,
      version: (existing.version as number) + 1,
      updated_by: by,
      updated_at: this.nextTime(),
    } as AnyRow
    this.tables.notes.set(id, row)
    return row
  }

  private canEdit(spaceId: string): boolean {
    const space = this.tables.spaces.get(spaceId)
    if (!space) return false
    if (this.me && space.owner_id === this.me) return true
    return this.access.some((a) => a.id === spaceId && a.role !== 'viewer')
  }

  /** Server-side rules the sync order depends on: RLS on the space, trigger on the parent. */
  private validate(table: WritableTable, payload: Record<string, unknown>, existing?: AnyRow) {
    if (table === 'spaces') return
    const spaceId = String(payload.space_id ?? existing?.space_id)
    if (!this.tables.spaces.has(spaceId)) throw forbiddenError()
    const column = table === 'folders' ? 'parent_id' : 'folder_id'
    if (!(column in payload)) return
    const parent = payload[column]
    if (typeof parent !== 'string') return
    const folder = this.tables.folders.get(parent)
    if (!folder || folder.space_id !== spaceId) throw validationError('BN_FOLDER_NOT_IN_SPACE')
    if (folder.deleted_at || folder.purged_at) throw validationError('BN_FOLDER_DELETED')
  }

  async touchPresence(): Promise<void> {
    this.calls.push({ method: 'touchPresence' })
  }

  async refreshAuth(): Promise<void> {
    this.calls.push({ method: 'refreshAuth' })
  }
}

export const networkError = () => new ApiError('network', 'TypeError: Failed to fetch')
export const fkError = () =>
  new ApiError('fk', 'insert or update violates foreign key constraint', '23503', 409)
export const serverError = () => new ApiError('server', 'internal error', 'PGRST000', 503)
export const forbiddenError = () =>
  new ApiError('forbidden', 'new row violates row-level security policy', '42501', 403)
export const authError = () => new ApiError('auth', 'JWT expired', 'PGRST301', 401)
export const validationError = (code: string) => new ApiError('validation', code, 'P0001', 400)

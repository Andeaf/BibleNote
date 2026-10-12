import type { SpaceRole } from '@/lib/database.types'
import { jsonEqual } from '@/lib/jsonEqual'
import {
  ApiError,
  type AnyRow,
  type PullPage,
  type PurgeResult,
  type SaveNoteResponse,
  type ServerTable,
  type StoredObject,
  type SyncApi,
  type TransferOptions,
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
    | 'uploadObject'
    | 'objectExists'
    | 'listObjects'
    | 'removeObjects'
    | 'purgeItems'
    | 'purgeExpired'
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
  /** Storage objects by path ('{space_id}/{file_id}'), with their server creation time. */
  readonly objects = new Map<string, { size: number; type: string; createdAt: string }>()
  /** Called at the start of every request, e.g. to change the server in the middle of a job. */
  beforeCall: (call: FakeCall) => void = () => undefined
  /**
   * Consulted after a successful write: return true to lose the answer (the write happened on
   * the server, the client gets a network error), as on a dropped mobile connection.
   */
  loseAnswerWhen: (call: FakeCall) => boolean = () => false
  /**
   * While set, uploads hang before storing anything (a stalled transfer) until `releaseUploads`
   * or until their signal aborts them.
   */
  holdUploads = false
  private held: Array<() => void> = []
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

  /** The server clock now (ISO), without advancing it. */
  serverNow(): string {
    return new Date(this.clock).toISOString()
  }

  /** Lets days pass on the server. */
  advance(ms: number): void {
    this.clock += ms
  }

  /** An object stored by someone else (another device), `ageMs` before the server's now. */
  seedObject(path: string, ageMs = 0): void {
    const createdAt = new Date(this.clock - ageMs).toISOString()
    this.objects.set(path, { size: 1, type: 'application/octet-stream', createdAt })
  }

  private record(call: FakeCall): void {
    this.calls.push(call)
    this.beforeCall(call)
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
    // A seeded trash item has been there since its deleted_at, unless the test says otherwise.
    if (TRASHABLE.has(table) && full.trashed_at === undefined) full.trashed_at = full.deleted_at
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
    const call: FakeCall = { method: 'pullPage', table, page }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
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
    this.record({ method: 'fetchByIds', table })
    const failure = this.failWhen({ method: 'fetchByIds', table })
    if (failure) throw failure
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
    // docs/PLAN.md §4.6d: a file row never exists on the server before its object. Not a server
    // rule (nothing enforces it there), so breaking it fails the test outright.
    if (table === 'files' && !this.objects.has(String(payload.storage_path))) {
      throw new Error('TEST INVARIANT: file row inserted before its Storage object')
    }
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
    if (TRASHABLE.has(table)) row.trashed_at = row.deleted_at ? time : null
    this.tables[table].set(id, row)
    if (this.loseAnswerWhen(call)) throw networkError()
    return { ...row }
  }

  /**
   * Storage upload with upsert off, like SupabaseStorageProvider: the editor policy on the
   * path's space (the space must exist on the server), and "already exists" for a taken path.
   */
  async uploadObject(
    path: string,
    blob: Blob,
    contentType: string,
    options?: TransferOptions,
  ): Promise<void> {
    const call: FakeCall = { method: 'uploadObject', id: path, payload: { size: blob.size } }
    this.calls.push(call)
    if (this.holdUploads) {
      await new Promise<void>((resolve, reject) => {
        this.held.push(resolve)
        options?.signal?.addEventListener('abort', () => reject(abortError()), { once: true })
      })
    }
    if (options?.signal?.aborted) throw abortError()
    const failure = this.failWhen(call)
    if (failure) throw failure
    const spaceId = path.split('/')[0] ?? ''
    if (!this.canEdit(spaceId)) throw forbiddenError()
    if (this.objects.has(path)) {
      throw new ApiError('unique', 'The resource already exists', 'BN_OBJECT_EXISTS', 409)
    }
    options?.onProgress?.(blob.size, blob.size)
    this.objects.set(path, { size: blob.size, type: contentType, createdAt: this.nextTime() })
    if (this.loseAnswerWhen(call)) throw networkError()
  }

  async serverTime(): Promise<string> {
    return this.serverNow()
  }

  async objectExists(path: string): Promise<boolean> {
    const call: FakeCall = { method: 'objectExists', id: path }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    return this.objects.has(path)
  }

  /** Like storage.list under the read policy: the objects of an accessible space. */
  async listObjects(spaceId: string): Promise<StoredObject[]> {
    const call: FakeCall = { method: 'listObjects', id: spaceId }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    if (!this.canRead(spaceId)) return []
    return [...this.objects.entries()]
      .filter(([path]) => path.startsWith(`${spaceId}/`))
      .map(([path, object]) => ({ path, createdAt: object.createdAt }))
      .sort((a, b) => (a.path < b.path ? -1 : 1))
  }

  /** The delete policy: owner of the path's space; anything else silently stays. */
  async removeObjects(paths: string[]): Promise<void> {
    const call: FakeCall = { method: 'removeObjects', payload: { paths } }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    for (const path of paths) {
      if (this.isOwner(path.split('/')[0] ?? '')) this.objects.delete(path)
    }
  }

  /** purge_items as in migration ..._purge_paths_and_expired.sql. */
  async purgeItems(ids: string[]): Promise<PurgeResult> {
    const call: FakeCall = { method: 'purgeItems', payload: { ids } }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    return this.purge(ids)
  }

  /** purge_expired: the caller's own items in the trash for more than 30 days (server clock). */
  async purgeExpired(): Promise<PurgeResult> {
    const call: FakeCall = { method: 'purgeExpired' }
    this.record(call)
    const failure = this.failWhen(call)
    if (failure) throw failure
    const cutoff = this.clock - 30 * 24 * 60 * 60 * 1000
    const expired = (row: AnyRow) =>
      !row.purged_at && typeof row.trashed_at === 'string' && Date.parse(row.trashed_at) < cutoff
    const ids: string[] = []
    for (const table of ['spaces', 'folders', 'notes', 'files'] as const) {
      for (const row of this.tables[table].values()) {
        const spaceId = String(table === 'spaces' ? row.id : row.space_id)
        if (expired(row) && this.isOwner(spaceId)) ids.push(row.id)
      }
    }
    return this.purge(ids)
  }

  private purge(ids: string[]): PurgeResult {
    const result: PurgeResult = { purged: 0, skipped: [], paths: [] }
    const scrub = (table: 'notes' | 'files' | 'folders', row: AnyRow, time: string) => {
      const scrubbed: AnyRow = {
        ...row,
        deleted_at: row.deleted_at ?? time,
        purged_at: time,
        updated_at: time,
      }
      if (table === 'notes')
        Object.assign(scrubbed, { title: '', content: {}, content_text: '', tags: [] })
      else scrubbed.name = ''
      if (table === 'files') result.paths.push(String(row.storage_path))
      this.tables[table].set(row.id, scrubbed)
    }
    for (const id of ids) {
      const time = this.nextTime()
      const inTrash = (row: AnyRow | undefined): row is AnyRow =>
        !!row && !!row.deleted_at && !row.purged_at
      const note = this.tables.notes.get(id)
      const file = this.tables.files.get(id)
      const folder = this.tables.folders.get(id)
      const space = this.tables.spaces.get(id)
      const single = inTrash(note)
        ? (['notes', note] as const)
        : inTrash(file)
          ? (['files', file] as const)
          : null
      if (single) {
        if (!this.isOwner(String(single[1].space_id))) {
          result.skipped.push(id)
          continue
        }
        scrub(single[0], single[1], time)
        result.purged++
        continue
      }
      if (inTrash(folder)) {
        if (!this.isOwner(String(folder.space_id))) {
          result.skipped.push(id)
          continue
        }
        const subtree = new Set([id])
        let grew = true
        while (grew) {
          grew = false
          for (const f of this.tables.folders.values()) {
            if (typeof f.parent_id === 'string' && subtree.has(f.parent_id) && !subtree.has(f.id)) {
              subtree.add(f.id)
              grew = true
            }
          }
        }
        for (const table of ['notes', 'files'] as const) {
          for (const row of [...this.tables[table].values()]) {
            if (!row.purged_at && subtree.has(String(row.folder_id))) scrub(table, row, time)
          }
        }
        for (const fid of subtree) {
          const row = this.tables.folders.get(fid)
          if (row && !row.purged_at) scrub('folders', row, time)
        }
        result.purged++
        continue
      }
      if (inTrash(space) && this.me && space.owner_id === this.me) {
        for (const table of ['notes', 'files', 'folders'] as const) {
          for (const row of [...this.tables[table].values()]) {
            if (!row.purged_at && row.space_id === id) scrub(table, row, time)
          }
        }
        this.tables.spaces.set(id, { ...space, name: '', purged_at: time, updated_at: time })
        result.purged++
        continue
      }
      result.skipped.push(id)
    }
    return result
  }

  /** Lets held uploads go on. */
  releaseUploads(): void {
    this.holdUploads = false
    for (const resolve of this.held.splice(0)) resolve()
  }

  /** Uploads waiting in `holdUploads`. */
  get heldUploads(): number {
    return this.held.length
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
    const time = this.nextTime()
    const row = { ...existing, ...payload, updated_at: time } as AnyRow
    // The set_trashed_at trigger: the server's clock, whatever deleted_at the client sent.
    if (TRASHABLE.has(table)) {
      if (!row.deleted_at) row.trashed_at = null
      else if (row.deleted_at !== existing.deleted_at) row.trashed_at = time
    }
    this.tables[table].set(id, row)
    if (this.loseAnswerWhen(call)) throw networkError()
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

  private isOwner(spaceId: string): boolean {
    const space = this.tables.spaces.get(spaceId)
    return !!space && !!this.me && space.owner_id === this.me
  }

  private canRead(spaceId: string): boolean {
    return this.isOwner(spaceId) || this.access.some((a) => a.id === spaceId)
  }

  private canEdit(spaceId: string): boolean {
    const space = this.tables.spaces.get(spaceId)
    if (!space) return false
    if (this.me && space.owner_id === this.me) return true
    return this.access.some((a) => a.id === spaceId && a.role !== 'viewer')
  }

  /** Server-side rules the sync order depends on: RLS on the space, trigger on the parent. */
  private validate(table: WritableTable, payload: Record<string, unknown>, existing?: AnyRow) {
    if (table === 'spaces' || table === 'profiles') return
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

const TRASHABLE = new Set<string>(['spaces', 'folders', 'notes', 'files'])

export const networkError = () => new ApiError('network', 'TypeError: Failed to fetch')
export const abortError = () => new ApiError('network', 'BN_ABORTED')
export const fkError = () =>
  new ApiError('fk', 'insert or update violates foreign key constraint', '23503', 409)
export const serverError = () => new ApiError('server', 'internal error', 'PGRST000', 503)
export const forbiddenError = () =>
  new ApiError('forbidden', 'new row violates row-level security policy', '42501', 403)
export const authError = () => new ApiError('auth', 'JWT expired', 'PGRST301', 401)
export const validationError = (code: string) => new ApiError('validation', code, 'P0001', 400)

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/database.types'
import type { StorageProvider } from '@/lib/storage/StorageProvider'
import {
  ApiError,
  type AnyRow,
  type PullPage,
  type SaveNoteResponse,
  type ServerTable,
  type SyncApi,
} from './types'

interface PostgrestFailure {
  code?: string
  message: string
}

/** Maps a supabase-js error to the retry classes the engine understands. */
export function toApiError(error: PostgrestFailure, status?: number): ApiError {
  const code = error.code ?? ''
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || (!code && /fetch|network|load failed|connection/i.test(error.message))) {
    return new ApiError('network', error.message, code, status)
  }
  if (code === '23503') return new ApiError('fk', error.message, code, status)
  if (code === '23505') return new ApiError('unique', error.message, code, status)
  if (code === '42501') return new ApiError('forbidden', error.message, code, status)
  if (code === 'P0001') return new ApiError('validation', error.message, code, status)
  // Expired or rejected JWT: refresh the session, then retry.
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') {
    return new ApiError('auth', error.message, code, status)
  }
  // Timeout, rate limit and server errors are transient.
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return new ApiError('server', error.message, code, status)
  }
  return new ApiError('unknown', error.message, code, status)
}

/**
 * SyncApi over supabase-js. Table names are dynamic here, so the typed client is used loosely;
 * type safety lives in the data layer, column safety in sync/columns.ts. File objects go
 * through the StorageProvider.
 */
export function createSupabaseApi(
  client: SupabaseClient<Database>,
  storage: StorageProvider,
): SyncApi {
  const loose = client as unknown as SupabaseClient
  return {
    async mySpaces() {
      const { data, error, status } = await client.rpc('my_spaces')
      if (error) throw toApiError(error, status)
      return data ?? []
    },

    async pullPage(table: ServerTable, page: PullPage) {
      let query = loose
        .from(table)
        .select('*')
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(page.limit)
      if (page.spaceId) {
        query =
          table === 'spaces' ? query.eq('id', page.spaceId) : query.eq('space_id', page.spaceId)
      }
      if (page.after) {
        const { updated_at, id } = page.after
        query = query.or(`updated_at.gt.${updated_at},and(updated_at.eq.${updated_at},id.gt.${id})`)
      } else if (page.since) {
        query = query.gte('updated_at', page.since)
      }
      const { data, error, status } = await query
      if (error) throw toApiError(error, status)
      return (data ?? []) as AnyRow[]
    },

    async fetchByIds(table, ids) {
      if (ids.length === 0) return []
      const { data, error, status } = await loose.from(table).select('*').in('id', ids)
      if (error) throw toApiError(error, status)
      return (data ?? []) as AnyRow[]
    },

    async insert(table, payload) {
      const { data, error, status } = await loose.from(table).insert(payload).select().single()
      if (error) throw toApiError(error, status)
      return data as AnyRow
    },

    async update(table, id, payload) {
      const { data, error, status } = await loose.from(table).update(payload).eq('id', id).select()
      if (error) throw toApiError(error, status)
      return (data ?? []) as AnyRow[]
    },

    async saveNote(note, baseVersion) {
      const { data, error, status } = await client.rpc('save_note', {
        p_note: note as Json,
        p_base_version: baseVersion,
      })
      if (error) throw toApiError(error, status)
      return data as unknown as SaveNoteResponse
    },

    uploadObject(path, blob, contentType, options) {
      return storage.upload(path, blob, contentType, options)
    },

    async refreshAuth() {
      const { error } = await client.auth.refreshSession()
      if (error) throw toApiError({ message: error.message, code: error.code }, error.status)
    },

    async touchPresence() {
      const { error, status } = await client.rpc('touch_presence')
      if (error) throw toApiError(error, status)
    },
  }
}

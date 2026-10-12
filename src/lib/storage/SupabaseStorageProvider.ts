import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { ApiError } from '@/sync/types'
import { SIGNED_URL_SECONDS, type StorageProvider } from './StorageProvider'

const BUCKET = 'files'

interface StorageFailure {
  message: string
  /** HTTP status (StorageApiError). */
  status?: number
  /** Storage's own code, often the HTTP status as a string ("409", "403"). */
  statusCode?: string
  name?: string
}

/**
 * Maps a storage-js error to the classes the sync engine understands. Storage answers a taken
 * path with 409 "Duplicate" (older versions: 400 with statusCode "409"), an RLS denial with 403,
 * an expired token with 400/403 and a JWT message, a file over the bucket limit with 413.
 */
export function toStorageApiError(error: StorageFailure): ApiError {
  const { message } = error
  const status = error.status
  const code = error.statusCode ?? ''
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline || (status === undefined && /fetch|network|load failed|connection/i.test(message))) {
    return new ApiError('network', message, code, status)
  }
  if (status === 409 || code === '409' || /already exists|duplicate/i.test(message)) {
    return new ApiError('unique', message, 'BN_OBJECT_EXISTS', status)
  }
  if (status === 401 || /jwt|"exp" claim|invalidjwt/i.test(`${message} ${code}`)) {
    return new ApiError('auth', message, code, status)
  }
  if (status === 413 || code === '413' || /too large|maximum allowed size/i.test(message)) {
    return new ApiError('validation', 'BN_FILE_TOO_LARGE', code, status)
  }
  if (status === 403 || code === '403' || /row-level security|unauthorized/i.test(message)) {
    return new ApiError('forbidden', message, '42501', status)
  }
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return new ApiError('server', message, code, status)
  }
  return new ApiError('unknown', message, code, status)
}

/** Files in the private Supabase bucket `files`; access follows has_space_access (§3.4). */
export function createSupabaseStorageProvider(client: SupabaseClient<Database>): StorageProvider {
  const bucket = () => client.storage.from(BUCKET)
  return {
    async upload(path, blob, contentType) {
      // upsert off: the bucket has no UPDATE policy, and an object is never replaced.
      const { error } = await bucket().upload(path, blob, {
        contentType,
        upsert: false,
        cacheControl: '3600',
      })
      if (error) throw toStorageApiError(error)
    },

    async getUrl(path, downloadAs) {
      const { data, error } = await bucket().createSignedUrl(
        path,
        SIGNED_URL_SECONDS,
        downloadAs ? { download: downloadAs } : undefined,
      )
      if (error) throw toStorageApiError(error)
      return data.signedUrl
    },

    async remove(paths) {
      if (paths.length === 0) return
      const { error } = await bucket().remove(paths)
      if (error) throw toStorageApiError(error)
    },

    async usage() {
      const { data, error, status } = await client.rpc('storage_usage')
      if (error) throw toStorageApiError({ message: error.message, status })
      return Number(data ?? 0)
    },
  }
}

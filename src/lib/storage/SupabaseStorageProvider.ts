import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { ApiError, type StoredObject } from '@/sync/types'
import {
  LIST_PAGE_SIZE,
  REMOVE_BATCH_SIZE,
  SIGNED_URL_SECONDS,
  type StorageProvider,
} from './StorageProvider'

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

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export interface StorageEndpoint {
  /** VITE_SUPABASE_URL */
  url: string
  /** VITE_SUPABASE_PUBLISHABLE_KEY */
  key: string
}

/**
 * Files in the private Supabase bucket `files`; access follows has_space_access (§3.4).
 * Uploads use XMLHttpRequest against the Storage REST API (what supabase-js does with fetch),
 * because only XHR reports upload progress and can be cancelled when a transfer stalls.
 */
export function createSupabaseStorageProvider(
  client: SupabaseClient<Database>,
  endpoint: StorageEndpoint,
): StorageProvider {
  const bucket = () => client.storage.from(BUCKET)
  return {
    async upload(path, blob, contentType, options) {
      const { data } = await client.auth.getSession()
      const token = data.session?.access_token ?? endpoint.key
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const signal = options?.signal
        const onAbort = () => xhr.abort()
        const done = () => signal?.removeEventListener('abort', onAbort)
        xhr.open('POST', `${endpoint.url}/storage/v1/object/${BUCKET}/${encodePath(path)}`)
        xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.setRequestHeader('apikey', endpoint.key)
        // upsert off: the bucket has no UPDATE policy, and an object is never replaced.
        xhr.setRequestHeader('x-upsert', 'false')
        xhr.setRequestHeader('Content-Type', contentType || 'application/octet-stream')
        xhr.upload.onprogress = (event) =>
          options?.onProgress?.(event.loaded, event.lengthComputable ? event.total : blob.size)
        xhr.onload = () => {
          done()
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
            return
          }
          let body: { message?: string; error?: string; statusCode?: string } = {}
          try {
            body = JSON.parse(xhr.responseText) as typeof body
          } catch {
            /* not JSON: the status decides */
          }
          reject(
            toStorageApiError({
              message: body.message ?? body.error ?? `HTTP ${xhr.status}`,
              status: xhr.status,
              statusCode: body.statusCode,
            }),
          )
        }
        xhr.onerror = () => {
          done()
          reject(new ApiError('network', 'Upload failed: network error'))
        }
        xhr.onabort = () => {
          done()
          reject(new ApiError('network', 'BN_ABORTED'))
        }
        if (signal?.aborted) {
          reject(new ApiError('network', 'BN_ABORTED'))
          return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        xhr.send(blob)
      })
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
      for (let i = 0; i < paths.length; i += REMOVE_BATCH_SIZE) {
        const { error } = await bucket().remove(paths.slice(i, i + REMOVE_BATCH_SIZE))
        if (error) throw toStorageApiError(error)
      }
    },

    async list(prefix) {
      const objects: StoredObject[] = []
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { data, error } = await bucket().list(prefix, {
          limit: LIST_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })
        if (error) throw toStorageApiError(error)
        for (const item of data) {
          // Folder placeholders have no id; a path has exactly one level under the space.
          if (item.id && item.created_at) {
            objects.push({ path: `${prefix}/${item.name}`, createdAt: item.created_at })
          }
        }
        if (data.length < LIST_PAGE_SIZE) return objects
      }
    },

    async exists(path) {
      try {
        const { data } = await bucket().exists(path)
        return data
      } catch (error) {
        throw toStorageApiError(error as StorageFailure)
      }
    },

    async usage() {
      const { data, error, status } = await client.rpc('storage_usage')
      if (error) throw toStorageApiError({ message: error.message, status })
      return Number(data ?? 0)
    },
  }
}

import type { StoredObject, TransferOptions } from '@/sync/types'

/**
 * Where file contents live. Only src/lib/storage/ talks to Supabase Storage; everything else
 * goes through this interface, so files can move to another provider later.
 * Errors are ApiError (src/sync/types.ts), classified like every other request.
 */
export interface StorageProvider {
  /**
   * Stores `blob` at `path` ('{space_id}/{file_id}'), never overwriting: a taken path throws
   * ApiError 'unique'. Reports progress and stops (ApiError 'network') when the signal aborts.
   */
  upload(path: string, blob: Blob, contentType: string, options?: TransferOptions): Promise<void>
  /** A temporary URL (1 h) to read the object; with `downloadAs` the browser saves it. */
  getUrl(path: string, downloadAs?: string): Promise<string>
  remove(paths: string[]): Promise<void>
  /** Every object directly under `prefix` ('{space_id}'), all pages read. */
  list(prefix: string): Promise<StoredObject[]>
  /** Whether an object is stored at `path`. */
  exists(path: string): Promise<boolean>
  /** Bytes used by all files of the project (the free plan has 1 GB in total). */
  usage(): Promise<number>
}

export const SIGNED_URL_SECONDS = 60 * 60
/** Objects per page when listing, and per request when removing. */
export const LIST_PAGE_SIZE = 1000
export const REMOVE_BATCH_SIZE = 100

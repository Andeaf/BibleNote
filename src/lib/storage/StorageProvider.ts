import type { TransferOptions } from '@/sync/types'

/**
 * Where file contents live. Only src/lib/storage/ talks to Supabase Storage; everything else
 * goes through this interface, so files can move to another provider later (docs/PLAN.md §3.4).
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
  /** Bytes used by all files of the project (the free plan has 1 GB in total). */
  usage(): Promise<number>
}

export const SIGNED_URL_SECONDS = 60 * 60

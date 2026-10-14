import type { BibleNoteDb, BlobEntry } from './db'

/** Offline cache of files opened recently. */
export const CACHE_LIMIT_BYTES = 200 * 1024 * 1024

/**
 * A new file waiting for upload. Call inside the transaction that writes the file row and its
 * outbox entry. The blob stays until the server has confirmed the object and the row.
 */
export async function putPendingBlob(
  db: BibleNoteDb,
  fileId: string,
  spaceId: string,
  blob: Blob,
  now = Date.now(),
): Promise<void> {
  await db.blobs.put({
    file_id: fileId,
    space_id: spaceId,
    blob,
    size: blob.size,
    pending: 1,
    last_access_at: now,
  })
}

/** Both upload stages are confirmed: the blob becomes an ordinary cache entry (evictable). */
export async function releaseBlob(
  db: BibleNoteDb,
  fileId: string,
  now = Date.now(),
): Promise<void> {
  await db.blobs.update(fileId, { pending: 0, last_access_at: now })
}

/** Reads a file's content from this device (pending or cached) and marks it as recently used. */
export async function readBlob(
  db: BibleNoteDb,
  fileId: string,
  now = Date.now(),
): Promise<Blob | null> {
  const entry = await db.blobs.get(fileId)
  if (!entry) return null
  if (entry.pending === 0) await db.blobs.update(fileId, { last_access_at: now })
  return entry.blob
}

/** Keeps a downloaded file for offline use, then trims the cache to its limit. */
export async function cacheBlob(
  db: BibleNoteDb,
  fileId: string,
  spaceId: string,
  blob: Blob,
  now = Date.now(),
  limit = CACHE_LIMIT_BYTES,
): Promise<void> {
  await db.transaction('rw', db.blobs, async () => {
    const existing = await db.blobs.get(fileId)
    // A pending blob is the original being uploaded: never replace it.
    if (existing?.pending === 1) return
    await db.blobs.put({
      file_id: fileId,
      space_id: spaceId,
      blob,
      size: blob.size,
      pending: 0,
      last_access_at: now,
    })
  })
  await trimCache(db, limit)
}

/** Evicts cached files, least recently used first, until they fit. Pending uploads stay. */
export async function trimCache(db: BibleNoteDb, limit = CACHE_LIMIT_BYTES): Promise<void> {
  await db.transaction('rw', db.blobs, async () => {
    const cached = await db.blobs.where('pending').equals(0).sortBy('last_access_at')
    let total = cached.reduce((sum, entry) => sum + entry.size, 0)
    const evict: string[] = []
    for (const entry of cached) {
      if (total <= limit) break
      evict.push(entry.file_id)
      total -= entry.size
    }
    if (evict.length > 0) await db.blobs.bulkDelete(evict)
  })
}

/** "Golește cache-ul": drops every cached file; files waiting for upload stay. */
export async function clearCache(db: BibleNoteDb): Promise<void> {
  await db.blobs.where('pending').equals(0).delete()
}

export interface BlobUsage {
  cachedBytes: number
  pendingBytes: number
  pendingCount: number
}

export async function blobUsage(db: BibleNoteDb): Promise<BlobUsage> {
  const usage: BlobUsage = { cachedBytes: 0, pendingBytes: 0, pendingCount: 0 }
  await db.blobs.each((entry: BlobEntry) => {
    if (entry.pending === 1) {
      usage.pendingBytes += entry.size
      usage.pendingCount += 1
    } else {
      usage.cachedBytes += entry.size
    }
  })
  return usage
}

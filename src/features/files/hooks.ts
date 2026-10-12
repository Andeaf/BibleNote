import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useState } from 'react'
import { cacheBlob, readBlob } from '@/lib/blobs'
import type { FileRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import type { StorageProvider } from '@/lib/storage/StorageProvider'
import { useDb, useSyncRuntime, useSyncState } from '@/sync/SyncContext'

/** Every file row of a space, trashed ones included (lists filter as needed). */
export function useSpaceFiles(spaceId: string): FileRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.files.where('space_id').equals(spaceId).toArray(), [db, spaceId])
}

/** `undefined` while loading, `null` when the file is not on this device. */
export function useFile(fileId: string): FileRow | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => (await db.files.get(fileId)) ?? null, [db, fileId])
}

/** Live files the account can reach (search). */
export function useAllFiles(): FileRow[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [files, spaces, access] = await Promise.all([
      db.files.toArray(),
      db.spaces.toArray(),
      db.spaceAccess.toArray(),
    ])
    const reachable = new Set(access.map((a) => a.space_id))
    const live = new Set(
      spaces.filter((s) => !s.deleted_at && reachable.has(s.id)).map((s) => s.id),
    )
    return files.filter((f) => !f.deleted_at && !f.purged_at && live.has(f.space_id))
  }, [db])
}

/**
 * What the file list says about a file not on the server yet: being sent (with the transfer's
 * percent, or null while its row is saved), queued behind another transfer, waiting for the
 * connection (offline or paused after network failures), or failed.
 */
export type UploadState =
  | { kind: 'uploading'; percent: number | null }
  | { kind: 'queued' }
  | { kind: 'waiting' }
  | { kind: 'failed' }

export function useUploadStates(): Map<string, UploadState> {
  const db = useDb()
  const { online, transfer } = useSyncState()
  const uploads = useLiveQuery(async () => {
    const now = Date.now()
    return (await db.outbox.toArray())
      .filter((e) => e.op === 'upload')
      .map((e) => ({
        rowId: e.row_id,
        failed: e.status === 'failed',
        uploaded: e.uploaded === true,
        paused: (e.next_transfer_at ?? 0) > now,
      }))
  }, [db])
  const states = new Map<string, UploadState>()
  for (const entry of uploads ?? []) {
    let state: UploadState
    if (entry.failed) state = { kind: 'failed' }
    else if (entry.uploaded) state = { kind: 'uploading', percent: null }
    else if (transfer?.rowId === entry.rowId) {
      const percent = Math.floor((transfer.loaded / Math.max(1, transfer.total)) * 100)
      state = { kind: 'uploading', percent: Math.min(99, percent) }
    } else if (!online || entry.paused) state = { kind: 'waiting' }
    else state = { kind: 'queued' }
    states.set(entry.rowId, state)
  }
  return states
}

// -----------------------------------------------------------------------------------------------
// File contents: local blob (pending upload or cache) first, otherwise download and cache.
// -----------------------------------------------------------------------------------------------

type Progress = (percent: number | null) => void

interface Download {
  promise: Promise<Blob>
  listeners: Set<Progress>
  controller: AbortController
}

/** One download per file, shared by every view that wants it, at most three at a time. */
const downloads = new Map<string, Download>()
const MAX_PARALLEL = 3
let running = 0
const waiting: Array<() => void> = []

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
  try {
    return await work()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}

async function fetchWithProgress(
  url: string,
  expected: number,
  type: string,
  signal: AbortSignal,
  onProgress: Progress,
): Promise<Blob> {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || expected
  const reader = response.body.getReader()
  const parts: Uint8Array<ArrayBuffer>[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value as Uint8Array<ArrayBuffer>)
    received += value.byteLength
    onProgress(total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : null)
  }
  return new Blob(parts, { type })
}

function download(db: BibleNoteDb, storage: StorageProvider, file: FileRow): Download {
  const existing = downloads.get(file.id)
  if (existing) return existing
  const controller = new AbortController()
  const listeners = new Set<Progress>()
  const notify: Progress = (percent) => {
    for (const listener of listeners) listener(percent)
  }
  const promise = slot(async () => {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const url = await storage.getUrl(file.storage_path)
    const blob = await fetchWithProgress(url, file.size_bytes, file.mime, controller.signal, notify)
    await cacheBlob(db, file.id, file.space_id, blob)
    return blob
  }).finally(() => downloads.delete(file.id))
  const entry = { promise, listeners, controller }
  downloads.set(file.id, entry)
  return entry
}

const LOADING: FileBlobState = { status: 'loading', percent: null }

export type FileBlobState =
  | { status: 'loading'; percent: number | null }
  | { status: 'ready'; blob: Blob; url: string }
  /** Not on this device and no connection. */
  | { status: 'offline' }
  | { status: 'error' }

/**
 * A file's content as an object URL: from this device when it is there (works offline),
 * otherwise downloaded through a signed URL (with progress) into the offline cache.
 * A download nobody waits for any more is cancelled. `enabled = false` waits (lazy thumbnails).
 */
export function useFileBlob(
  file: FileRow | null | undefined,
  enabled = true,
): [FileBlobState, () => void] {
  const { db, storage } = useSyncRuntime()
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const id = file?.id
  // The state belongs to one file and attempt; anything else reads as "loading".
  const key = `${id ?? ''}:${attempt}`
  const [state, setState] = useState<{ key: string; value: FileBlobState }>({
    key: '',
    value: LOADING,
  })

  useEffect(() => {
    if (!file || !enabled) return
    let cancelled = false
    let url: string | null = null
    let job: Download | null = null
    const set = (value: FileBlobState) => {
      if (!cancelled) setState({ key, value })
    }
    const onProgress: Progress = (percent) => set({ status: 'loading', percent })
    const show = (blob: Blob) => {
      if (cancelled) return
      url = URL.createObjectURL(blob)
      set({ status: 'ready', blob, url })
    }
    void (async () => {
      const local = await readBlob(db, file.id).catch(() => null)
      if (local) return show(local)
      if (cancelled) return
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        set({ status: 'offline' })
        return
      }
      job = download(db, storage, file)
      job.listeners.add(onProgress)
      try {
        show(await job.promise)
      } catch {
        set(navigator.onLine === false ? { status: 'offline' } : { status: 'error' })
      }
    })()
    return () => {
      cancelled = true
      if (job) {
        job.listeners.delete(onProgress)
        if (job.listeners.size === 0) job.controller.abort()
      }
      if (url) URL.revokeObjectURL(url)
    }
    // The row object changes on every sync; the content of a file id never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, storage, key, enabled])

  return [state.key === key ? state.value : LOADING, retry]
}

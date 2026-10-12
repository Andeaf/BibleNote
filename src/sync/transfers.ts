import type { BibleNoteDb } from '@/lib/db'
import { outboxKey, unsentCreateKeys } from './outbox'
import { ApiError, type OutboxEntry, type SyncApi, type TransferProgress } from './types'

/** Pauses after network failures of a transfer while the device says it is online. */
export const TRANSFER_PAUSES_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const
/** A transfer without progress for this long is cancelled and counts as a network failure. */
export const STALL_MS = 60_000

export interface TransferLaneDeps {
  db: BibleNoteDb
  api: SyncApi
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  isOnline: () => boolean
  maxAttempts: number
  backoffMs: (attempts: number) => number
  /** The object is stored: the main queue can insert the row now. */
  onUploaded: () => void
  /** The transfer in progress (null when none), for the indicator and the file list. */
  onProgress: (current: TransferProgress | null) => void
  markFailed: (entry: OutboxEntry, error: string) => Promise<void>
}

interface ActiveTransfer {
  seq: number
  rowId: string
  /** The page went to the background during the transfer: a cut then is not the network's fault. */
  hidden: boolean
  controller: AbortController
}

/**
 * The file transfers of `upload` entries (docs/PLAN.md §4.6d), on their own lane so a big or
 * failing upload never holds back the main queue. One transfer at a time, in seq order, once
 * the file's main folder exists on the server (the Storage policy needs it). The entry stays
 * `pending` in IndexedDB while it is transferred (never `inflight`), so recovering entries left
 * in flight cannot touch it; a transfer cut by closing the app simply starts again.
 *
 * Failures: "already exists" is success (fixed path, our own earlier upload). A network failure
 * waits for the connection when the device is offline; cut in the background, it goes again
 * when the page is visible (at once if it already is), and otherwise pauses the lane 1, 5, 15, then 60 minutes
 * (reset by the `online` event). A transfer without progress for 60 s is cancelled as a network
 * failure. 5xx / expired token: retried with the usual backoff, at most `maxAttempts` times.
 * Anything else fails the entry.
 */
export class TransferLane {
  /** When the wake-up timer fires (engine clock), or null. Exposed for tests. */
  nextWakeAt: number | null = null
  private readonly deps: TransferLaneDeps
  private running: Promise<void> | null = null
  private again = false
  private active: ActiveTransfer | null = null
  private visible = true
  private waitForVisible = false
  private wakeTimer: unknown = null
  private disposed = false

  constructor(deps: TransferLaneDeps) {
    this.deps = deps
  }

  /** Runs the lane if it is idle; a call while it runs asks for one more look at the queue. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.loop().finally(() => {
      this.running = null
    })
    return this.running
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (!visible && this.active) this.active.hidden = true
    if (visible && this.waitForVisible) {
      this.waitForVisible = false
      void this.run()
    }
  }

  /** The `online` event: pauses after network failures start over. */
  async resetPauses(): Promise<void> {
    await this.deps.db.outbox
      .filter((e) => e.op === 'upload' && !e.uploaded)
      .modify({ transfer_failures: 0, next_transfer_at: 0 })
    void this.run()
  }

  /** The entry was discarded or its space removed: stop sending its file. */
  cancel(rowId: string): void {
    if (this.active?.rowId === rowId) this.active.controller.abort()
  }

  /** The app stops (sign-out, reload): a cut transfer starts again next time, without a pause. */
  dispose(): void {
    this.disposed = true
    this.active?.controller.abort()
    if (this.wakeTimer !== null) this.deps.clearTimer(this.wakeTimer)
    this.wakeTimer = null
    this.nextWakeAt = null
  }

  private async loop(): Promise<void> {
    try {
      do {
        this.again = false
        while (await this.next()) {
          /* one transfer at a time */
        }
      } while (this.again)
    } finally {
      await this.scheduleWake().catch(() => undefined)
    }
  }

  /** Transfers the next file, if one may go now; false when there is nothing to do. */
  private async next(): Promise<boolean> {
    if (this.disposed || this.waitForVisible || !this.deps.isOnline()) return false
    const entries = await this.deps.db.outbox.orderBy('seq').toArray()
    const unsent = unsentCreateKeys(entries)
    for (const entry of entries) {
      if (entry.op !== 'upload' || entry.uploaded || entry.status === 'failed') continue
      // Its main folder is not on the server yet: Storage would refuse it. Others may go.
      if (unsent.has(outboxKey('spaces', entry.space_id))) continue
      // Paused after a failure: the files keep their order, nothing overtakes it.
      if ((entry.next_transfer_at ?? 0) > this.deps.now()) return false
      await this.transfer(entry)
      return true
    }
    return false
  }

  private publish(current: TransferProgress | null): void {
    this.deps.onProgress(current)
  }

  private async transfer(entry: OutboxEntry): Promise<void> {
    const { db, api } = this.deps
    const seq = entry.seq as number
    const stored = await db.blobs.get(entry.row_id)
    if (!stored) {
      await this.deps.markFailed(entry, 'BN_BLOB_MISSING')
      return
    }
    const active: ActiveTransfer = {
      seq,
      rowId: entry.row_id,
      hidden: !this.visible,
      controller: new AbortController(),
    }
    this.active = active
    this.publish({ rowId: entry.row_id, loaded: 0, total: stored.size })
    let stall: unknown = null
    const watch = () => {
      if (stall !== null) this.deps.clearTimer(stall)
      stall = this.deps.setTimer(() => active.controller.abort(), STALL_MS)
    }
    watch()
    let failure: unknown = null
    try {
      await api.uploadObject(
        String(entry.payload.storage_path),
        stored.blob,
        String(entry.payload.mime || stored.blob.type || 'application/octet-stream'),
        {
          signal: active.controller.signal,
          onProgress: (loaded, total) => {
            this.publish({ rowId: entry.row_id, loaded, total: total || stored.size })
            watch()
          },
        },
      )
    } catch (error) {
      // A taken path is our own earlier upload whose answer was lost.
      if (!(error instanceof ApiError && error.kind === 'unique')) failure = error
    } finally {
      if (stall !== null) this.deps.clearTimer(stall)
      this.active = null
      this.publish(null)
    }

    if (this.disposed) return
    // Read and written in one transaction, so the entry cannot change in between. Discarded
    // meanwhile: nothing left to update. Failed meanwhile (kept with BN_ACCESS_LOST when its
    // space went, see removeSpaceLocally): a stored object only marks it uploaded, the rest of
    // the entry stays as it is so "Renunță" still knows it.
    const current = await db.transaction('rw', db.outbox, async () => {
      const found = await db.outbox.get(seq)
      if (!found || failure !== null) return found
      await db.outbox.update(
        seq,
        found.status === 'failed'
          ? { uploaded: true }
          : {
              uploaded: true,
              transfer_failures: 0,
              next_transfer_at: 0,
              attempts: 0,
              last_error: null,
            },
      )
      return found
    })
    if (!current || current.status === 'failed') return
    if (failure === null) {
      this.deps.onUploaded()
      return
    }
    await this.handleFailure(current, failure, active)
  }

  /** Updates the entry unless it was discarded or failed meanwhile. */
  private async updateOpen(seq: number, changes: Partial<OutboxEntry>): Promise<void> {
    const { db } = this.deps
    await db.transaction('rw', db.outbox, async () => {
      const found = await db.outbox.get(seq)
      if (found && found.status !== 'failed') await db.outbox.update(seq, changes)
    })
  }

  private async handleFailure(
    entry: OutboxEntry,
    failure: unknown,
    active: ActiveTransfer,
  ): Promise<void> {
    const { api, now } = this.deps
    const seq = entry.seq as number
    const message = failure instanceof Error ? failure.message : String(failure)
    const kind = failure instanceof ApiError ? failure.kind : 'unknown'
    if (kind === 'network') {
      // Offline: the `online` event starts the lane again. Cut in the background: neither is the
      // connection's fault, so no pause grows. Still hidden: wait for the page to come back.
      // Visible again already (the order of `visibilitychange` and the request's error or stall
      // timer is not guaranteed, on iOS the page usually comes back first): go again at once,
      // the loop picks the same entry. Waiting then would stop the lane until the next return.
      if (!this.deps.isOnline()) return
      if (active.hidden || !this.visible) {
        if (!this.visible) this.waitForVisible = true
        return
      }
      const failures = (entry.transfer_failures ?? 0) + 1
      const pause = TRANSFER_PAUSES_MS[Math.min(failures, TRANSFER_PAUSES_MS.length) - 1]
      await this.updateOpen(seq, {
        transfer_failures: failures,
        next_transfer_at: now() + (pause as number),
        last_error: message,
      })
      return
    }
    if (kind === 'server' || kind === 'auth' || kind === 'fk') {
      if (kind === 'auth') await api.refreshAuth().catch(() => undefined)
      const attempts = entry.attempts + 1
      if (attempts >= this.deps.maxAttempts) {
        await this.deps.markFailed(entry, message)
      } else {
        await this.updateOpen(seq, {
          attempts,
          next_transfer_at: now() + this.deps.backoffMs(attempts),
          last_error: message,
        })
      }
      return
    }
    await this.deps.markFailed(entry, message)
  }

  /** Wakes the lane at the end of the earliest pause. */
  private async scheduleWake(): Promise<void> {
    if (this.wakeTimer !== null) this.deps.clearTimer(this.wakeTimer)
    this.wakeTimer = null
    this.nextWakeAt = null
    if (this.disposed) return
    const now = this.deps.now()
    let earliest: number | null = null
    await this.deps.db.outbox
      .filter((e) => e.op === 'upload' && !e.uploaded && e.status !== 'failed')
      .each((entry) => {
        const at = entry.next_transfer_at ?? 0
        if (at > now && (earliest === null || at < earliest)) earliest = at
      })
    if (earliest === null) return
    this.nextWakeAt = earliest
    this.wakeTimer = this.deps.setTimer(
      () => {
        this.wakeTimer = null
        this.nextWakeAt = null
        void this.run()
      },
      Math.max(0, (earliest as number) - now),
    )
  }
}

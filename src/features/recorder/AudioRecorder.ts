import {
  appendChunk,
  finishRecording,
  nextPart,
  savePart,
  startRecording,
  updateRecording,
} from '@/data/recordings'
import type { FileRow } from '@/lib/database.types'
import type { BibleNoteDb } from '@/lib/db'
import { newId } from '@/lib/ids'
import { AUDIO_BITS_PER_SECOND, CHUNK_MS, SPLIT_BYTES, pickRecordingMime } from '@/lib/recording'
import { createStore } from '@/sync/store'

export type RecorderStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'saving'
  | 'done'
  /** Stopping could not save: the chunks stay in IndexedDB for the recovery prompt. */
  | 'failed'
export type RecorderError = 'denied' | 'unsupported' | 'failed' | 'save'

/** Why a recording ended: the user, the microphone, a full device, or another write error. */
export type StopReason = 'user' | 'microphone' | 'storage' | 'error'

export interface RecorderSnapshot {
  status: RecorderStatus
  part: number
  error: RecorderError | null
  /** True while the Screen Wake Lock holds; otherwise the UI asks to keep the screen on. */
  wakeLock: boolean
  /** Recorded time (ms) at which the microphone went quiet: muted track or missing chunks. */
  interruptions: number[]
  /** Recorded time (ms) safely stored in IndexedDB (up to the last chunk written). */
  savedMs: number
  /** Why the last stop happened; with status 'failed' that stop could not save. */
  reason: StopReason | null
}

/**
 * The recording this tab is making, if any. The update prompt waits while it is set (a reload
 * would cut the recording) and the recovery prompt skips it.
 */
export const activeRecording = createStore<{ id: string | null }>({ id: null })

/** The files made from a recording, and why it ended. */
export type FinishedCallback = (rows: FileRow[], reason: StopReason) => void

export interface RecordingTarget {
  spaceId: string
  folderId: string | null
  name: string
}

export interface RecorderClock {
  now: () => number
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/** How often the health check runs, and how often a recording in progress touches its row. */
const TICK_MS = 1000
const HEARTBEAT_MS = 5000
/** No chunk for this long while recording: the microphone was interrupted. */
export const SILENCE_MS = 2 * CHUNK_MS

const browserClock: RecorderClock = {
  now: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
}

const isQuotaError = (error: unknown) =>
  error instanceof Error && /quota/i.test(`${error.name} ${error.message}`)

/**
 * MediaRecorder around IndexedDB: a chunk every 5 s goes straight into
 * Dexie, pause/resume, Screen Wake Lock, and a split into a new part at 45 MB without a gap
 * (the next part starts before the old one stops). Stopping turns the recording into files in
 * the upload queue; anything left after a crash is offered again at the next start.
 *
 * Nothing is lost silently: the first failed chunk write (a full phone) stops the recording and
 * saves what is stored; a stop that cannot save still releases the microphone, the wake lock and
 * the leave warning, and leaves the chunks for the recovery prompt. A muted track (iOS: screen
 * locked, a call) or chunks that stop arriving are reported with the minute, without stopping.
 */
export class AudioRecorder {
  readonly state = createStore<RecorderSnapshot>({
    status: 'idle',
    part: 1,
    error: null,
    wakeLock: false,
    interruptions: [],
    savedMs: 0,
    reason: null,
  })
  private readonly db: BibleNoteDb
  private readonly userId: string
  private readonly clock: RecorderClock
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private mime = ''
  private id = ''
  private part = 1
  private partStartedMs = 0
  private accumulatedMs = 0
  private resumedAt: number | null = null
  private writes: Promise<void> = Promise.resolve()
  private writeFailed = false
  private splitting: Promise<void> | null = null
  private saved: FileRow[] = []
  private wakeLock: WakeLockSentinel | null = null
  private ticker: unknown = null
  private lastChunkAt = 0
  private lastHeartbeatAt = 0
  private onFinished: FinishedCallback = () => undefined

  constructor(db: BibleNoteDb, userId: string, clock: RecorderClock = browserClock) {
    this.db = db
    this.userId = userId
    this.clock = clock
  }

  /** Recorded time, pauses excluded. */
  elapsedMs(): number {
    return this.accumulatedMs + (this.resumedAt === null ? 0 : this.clock.now() - this.resumedAt)
  }

  private get status(): RecorderStatus {
    return this.state.get().status
  }

  private get active(): boolean {
    return this.status === 'recording' || this.status === 'paused'
  }

  /** `onFinished` gets the files made from the recording once it is stopped and saved. */
  async start(target: RecordingTarget, onFinished: FinishedCallback): Promise<void> {
    if (this.status !== 'idle') return
    this.onFinished = onFinished
    const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    const mime = supported ? pickRecordingMime((type) => MediaRecorder.isTypeSupported(type)) : null
    if (!mime) {
      this.state.update({ error: 'unsupported' })
      return
    }
    this.state.update({ status: 'starting', error: null })
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      const denied =
        error instanceof Error &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      this.state.update({ status: 'idle', error: denied ? 'denied' : 'failed' })
      return
    }
    try {
      this.mime = mime
      this.id = newId()
      await startRecording(this.db, { id: this.id, ...target, mime })
      activeRecording.set({ id: this.id })
      for (const track of this.stream.getAudioTracks()) {
        // The microphone was taken away for good: keep what we have.
        track.addEventListener('ended', () => void this.stop('microphone'))
        // iOS mutes the track (screen locked, a call) without ending it: report, keep going.
        track.addEventListener('mute', () => this.interrupted(this.elapsedMs()))
      }
      this.beginPart()
      this.resumedAt = this.clock.now()
      this.lastChunkAt = this.clock.now()
      this.lastHeartbeatAt = this.clock.now()
      this.ticker = this.clock.setInterval(() => this.tick(), TICK_MS)
      this.state.update({ status: 'recording' })
      document.addEventListener('visibilitychange', this.onVisibility)
      window.addEventListener('beforeunload', this.onBeforeUnload)
      await this.holdScreen()
    } catch {
      this.release()
      this.state.update({ status: 'idle', error: 'failed' })
    }
  }

  pause(): void {
    if (this.status !== 'recording' || !this.recorder) return
    this.recorder.pause()
    this.accumulatedMs = this.elapsedMs()
    this.resumedAt = null
    this.state.update({ status: 'paused' })
    void updateRecording(this.db, this.id, { elapsed_ms: this.accumulatedMs }).catch(
      () => undefined,
    )
  }

  resume(): void {
    if (this.status !== 'paused' || !this.recorder) return
    this.recorder.resume()
    this.resumedAt = this.clock.now()
    this.lastChunkAt = this.clock.now()
    this.state.update({ status: 'recording' })
  }

  rename(name: string): void {
    if (this.id && name.trim()) {
      void updateRecording(this.db, this.id, { name: name.trim() }).catch(() => undefined)
    }
  }

  /**
   * "Oprește și salvează", or the recording had to end (microphone gone, a write failed): the
   * parts become files. Whatever happens, the microphone, the wake lock and the leave warning
   * are released; if saving fails the chunks stay for the recovery prompt.
   */
  async stop(reason: StopReason = 'user'): Promise<void> {
    if (!this.active) return
    this.accumulatedMs = this.elapsedMs()
    this.resumedAt = null
    this.state.update({ status: 'saving', reason })
    let rows: FileRow[] | null
    try {
      if (this.splitting) await this.splitting
      await this.stopRecorder(this.recorder)
      await this.writes
      // After a failed write the file holds what reached IndexedDB: up to the last chunk.
      const until = this.writeFailed ? this.state.get().savedMs : this.accumulatedMs
      rows = await finishRecording(this.db, this.userId, this.id, until)
    } catch {
      rows = null
    } finally {
      this.release()
    }
    if (rows === null) {
      this.state.update({ status: 'failed', error: 'save' })
      return
    }
    this.state.update({ status: 'done' })
    this.onFinished([...this.saved, ...rows], reason)
  }

  /** "Renunță": stops without saving; returns the recording id so the caller deletes its data. */
  cancel(): string | null {
    const id = this.id || null
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.release()
    this.resumedAt = null
    this.state.update({ status: 'idle' })
    return id
  }

  /**
   * Once a second while recording: a silence of two chunk intervals means the microphone was
   * interrupted (the page was suspended, the track muted); every 5 s the recording row is
   * touched, so another tab never mistakes a paused recording for an unfinished one.
   */
  tick(): void {
    if (!this.active) return
    const now = this.clock.now()
    if (this.status === 'recording' && now - this.lastChunkAt > SILENCE_MS) {
      this.interrupted(this.state.get().savedMs)
      // One report per silence: the next one only after chunks came back.
      this.lastChunkAt = Number.POSITIVE_INFINITY
    }
    if (now - this.lastHeartbeatAt >= HEARTBEAT_MS) {
      this.lastHeartbeatAt = now
      void updateRecording(this.db, this.id, {}).catch(() => undefined)
    }
  }

  /** Reports an interruption at `atMs` of recorded time, once per incident. */
  private interrupted(atMs: number): void {
    const list = this.state.get().interruptions
    const last = list[list.length - 1]
    if (last !== undefined && Math.abs(atMs - last) < SILENCE_MS) return
    this.state.update({ interruptions: [...list, atMs] })
  }

  private beginPart(): void {
    if (!this.stream) return
    const part = this.part
    const recorder = new MediaRecorder(this.stream, {
      mimeType: this.mime,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    })
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.write(part, event.data)
    })
    recorder.addEventListener('error', () => void this.stop('microphone'))
    recorder.start(CHUNK_MS)
    if (this.status === 'paused') recorder.pause()
    this.recorder = recorder
  }

  /**
   * Chunks are written one after another, in arrival order. The first write that fails (a full
   * phone: QuotaExceededError) ends the recording and saves what is stored; later chunks are
   * not written any more.
   */
  private write(part: number, data: Blob): void {
    if (this.writeFailed) return
    const elapsed = this.elapsedMs()
    this.lastChunkAt = this.clock.now()
    this.writes = this.writes.then(async () => {
      if (this.writeFailed) return
      try {
        const bytes = await appendChunk(this.db, this.id, part, data, elapsed)
        this.state.update({ savedMs: Math.max(this.state.get().savedMs, elapsed) })
        if (part === this.part && bytes >= SPLIT_BYTES && !this.splitting) {
          this.splitting = this.split()
            .catch((error: unknown) => this.writeError(error))
            .finally(() => {
              this.splitting = null
            })
        }
      } catch (error) {
        this.writeError(error)
      }
    })
  }

  private writeError(error: unknown): void {
    if (this.writeFailed) return
    this.writeFailed = true
    void this.stop(isQuotaError(error) ? 'storage' : 'error')
  }

  /** At 45 MB: the next part starts recording first, then the old part stops and is saved. */
  private async split(): Promise<void> {
    if (!this.active) return
    const old = this.recorder
    const oldPart = this.part
    const at = this.elapsedMs()
    const duration = (at - this.partStartedMs) / 1000
    this.part = await nextPart(this.db, this.id, at)
    this.partStartedMs = at
    this.beginPart()
    this.state.update({ part: this.part })
    await this.stopRecorder(old)
    await this.writes
    const row = await savePart(this.db, this.userId, this.id, oldPart, duration)
    if (row) this.saved.push(row)
  }

  private stopRecorder(recorder: MediaRecorder | null): Promise<void> {
    if (!recorder || recorder.state === 'inactive') return Promise.resolve()
    return new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })
  }

  private async holdScreen(): Promise<void> {
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      this.wakeLock = null
    }
    this.state.update({ wakeLock: !!this.wakeLock })
    this.wakeLock?.addEventListener('release', () => {
      this.wakeLock = null
      this.state.update({ wakeLock: false })
    })
  }

  /** The wake lock is dropped when the page is hidden; take it again on return. */
  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible' && this.active && !this.wakeLock) {
      void this.holdScreen()
    }
  }

  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    if (this.ticker !== null) this.clock.clearInterval(this.ticker)
    this.ticker = null
    void this.wakeLock?.release().catch(() => undefined)
    this.wakeLock = null
    this.state.update({ wakeLock: false })
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    if (activeRecording.get().id === this.id) activeRecording.set({ id: null })
  }
}

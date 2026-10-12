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

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'saving' | 'done'
export type RecorderError = 'denied' | 'unsupported' | 'failed'

export interface RecorderSnapshot {
  status: RecorderStatus
  part: number
  error: RecorderError | null
  /** True while the Screen Wake Lock holds; otherwise the UI asks to keep the screen on. */
  wakeLock: boolean
}

/**
 * The recording this tab is making, if any. The update prompt waits while it is set (a reload
 * would cut the recording) and the recovery prompt skips it.
 */
export const activeRecording = createStore<{ id: string | null }>({ id: null })

/** The files made from a recording; `interrupted` when the microphone ended it, not the user. */
export type FinishedCallback = (rows: FileRow[], interrupted: boolean) => void

export interface RecordingTarget {
  spaceId: string
  folderId: string | null
  name: string
}

/**
 * MediaRecorder around IndexedDB (docs/PLAN.md §5.6): a chunk every 5 s goes straight into
 * Dexie, pause/resume, Screen Wake Lock, and a split into a new part at 45 MB without a gap
 * (the next part starts before the old one stops). Stopping turns the recording into files in
 * the upload queue; anything left after a crash is offered again at the next start.
 */
export class AudioRecorder {
  readonly state = createStore<RecorderSnapshot>({
    status: 'idle',
    part: 1,
    error: null,
    wakeLock: false,
  })
  private readonly db: BibleNoteDb
  private readonly userId: string
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private mime = ''
  private id = ''
  private part = 1
  private partStartedMs = 0
  private accumulatedMs = 0
  private resumedAt: number | null = null
  private writes: Promise<void> = Promise.resolve()
  private splitting: Promise<void> | null = null
  private saved: FileRow[] = []
  private wakeLock: WakeLockSentinel | null = null
  private onFinished: FinishedCallback = () => undefined

  constructor(db: BibleNoteDb, userId: string) {
    this.db = db
    this.userId = userId
  }

  /** Recorded time, pauses excluded. */
  elapsedMs(): number {
    return this.accumulatedMs + (this.resumedAt === null ? 0 : performance.now() - this.resumedAt)
  }

  private get status(): RecorderStatus {
    return this.state.get().status
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
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      this.state.update({ status: 'idle', error: denied ? 'denied' : 'failed' })
      return
    }
    try {
      this.mime = mime
      this.id = newId()
      await startRecording(this.db, { id: this.id, ...target, mime })
      activeRecording.set({ id: this.id })
      // The microphone was taken away (a call, iOS suspending the page): keep what we have.
      for (const track of this.stream.getAudioTracks()) {
        track.addEventListener('ended', () => void this.stop(true))
      }
      this.beginPart()
      this.resumedAt = performance.now()
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
    void updateRecording(this.db, this.id, { elapsed_ms: this.accumulatedMs })
  }

  resume(): void {
    if (this.status !== 'paused' || !this.recorder) return
    this.recorder.resume()
    this.resumedAt = performance.now()
    this.state.update({ status: 'recording' })
  }

  rename(name: string): void {
    if (this.id && name.trim()) void updateRecording(this.db, this.id, { name: name.trim() })
  }

  /** "Oprește și salvează" (or the microphone ended): the parts become files. */
  async stop(interrupted = false): Promise<void> {
    if (this.status !== 'recording' && this.status !== 'paused') return
    this.accumulatedMs = this.elapsedMs()
    this.resumedAt = null
    this.state.update({ status: 'saving' })
    if (this.splitting) await this.splitting
    await this.stopRecorder(this.recorder)
    await this.writes
    const rows = await finishRecording(this.db, this.userId, this.id, this.accumulatedMs)
    this.release()
    this.state.update({ status: 'done' })
    this.onFinished([...this.saved, ...rows], interrupted)
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
    recorder.addEventListener('error', () => void this.stop(true))
    recorder.start(CHUNK_MS)
    if (this.status === 'paused') recorder.pause()
    this.recorder = recorder
  }

  /** Chunks are written one after another, in arrival order. */
  private write(part: number, data: Blob): void {
    const elapsed = this.elapsedMs()
    this.writes = this.writes
      .then(async () => {
        const bytes = await appendChunk(this.db, this.id, part, data, elapsed)
        if (part === this.part && bytes >= SPLIT_BYTES && !this.splitting) {
          this.splitting = this.split().finally(() => {
            this.splitting = null
          })
        }
      })
      .catch(() => undefined)
  }

  /** At 45 MB: the next part starts recording first, then the old part stops and is saved. */
  private async split(): Promise<void> {
    if (this.status !== 'recording' && this.status !== 'paused') return
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
    const active = this.status === 'recording' || this.status === 'paused'
    if (document.visibilityState === 'visible' && active && !this.wakeLock) void this.holdScreen()
  }

  private readonly onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.recorder = null
    void this.wakeLock?.release().catch(() => undefined)
    this.wakeLock = null
    document.removeEventListener('visibilitychange', this.onVisibility)
    window.removeEventListener('beforeunload', this.onBeforeUnload)
    if (activeRecording.get().id === this.id) activeRecording.set({ id: null })
  }
}

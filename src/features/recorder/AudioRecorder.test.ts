import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileRow } from '@/lib/database.types'
import { BibleNoteDb } from '@/lib/db'
import { AudioRecorder, SILENCE_MS, activeRecording, type StopReason } from './AudioRecorder'

/**
 * The recorder never loses sound silently (docs/PLAN.md §5.6): a full phone stops and saves, a
 * failed save releases the microphone and keeps the chunks, interruptions are reported.
 * MediaRecorder, the microphone and the page are fakes; the clock is driven by the test.
 */

class FakeTrack extends EventTarget {
  stopped = false
  stop() {
    this.stopped = true
  }
}

class FakeStream {
  readonly track = new FakeTrack()
  getAudioTracks() {
    return [this.track]
  }
  getTracks() {
    return [this.track]
  }
}

class FakeMediaRecorder extends EventTarget {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = () => true
  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  constructor() {
    super()
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    queueMicrotask(() => this.dispatchEvent(new Event('stop')))
  }
  /** A chunk from the encoder. */
  emit(text: string) {
    const event = new Event('dataavailable')
    Object.assign(event, { data: new Blob([text], { type: 'audio/webm' }) })
    this.dispatchEvent(event)
  }
}

let db: BibleNoteDb
let stream: FakeStream
let clock: number
let recorder: AudioRecorder
let finished: { rows: FileRow[]; reason: StopReason } | null
const windowEvents = { addEventListener: vi.fn(), removeEventListener: vi.fn() }

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const status = () => recorder.state.get().status
const current = () => FakeMediaRecorder.instances.at(-1) as FakeMediaRecorder

/** Waits for a condition (an IndexedDB write, a stop), never for a fixed time. */
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 500; i++) {
    if (await check()) return
    await settle()
  }
  throw new Error('timed out')
}

async function startRecording() {
  await recorder.start({ spaceId: 'space-a', folderId: null, name: 'Predica' }, (rows, reason) => {
    finished = { rows, reason }
  })
  expect(status()).toBe('recording')
}

/** A chunk at `ms` of recording time, written to IndexedDB. */
async function chunk(ms: number, text: string, stored = true) {
  clock = ms
  current().emit(text)
  if (stored) await until(() => recorder.state.get().savedMs >= ms)
}

beforeEach(() => {
  db = new BibleNoteDb(`test-${crypto.randomUUID()}`)
  stream = new FakeStream()
  clock = 0
  finished = null
  FakeMediaRecorder.instances = []
  windowEvents.addEventListener.mockClear()
  windowEvents.removeEventListener.mockClear()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('navigator', {
    userAgent: 'test',
    mediaDevices: { getUserMedia: async () => stream },
  })
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })
  vi.stubGlobal('window', windowEvents)
  recorder = new AudioRecorder(db, 'user-1', {
    now: () => clock,
    setInterval: () => 'ticker',
    clearInterval: () => undefined,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  db.close()
})

const removedBeforeUnload = () =>
  windowEvents.removeEventListener.mock.calls.some(([type]) => type === 'beforeunload')

describe('AudioRecorder', () => {
  it('a full phone stops the recording and saves what was stored', async () => {
    const add = db.recordingChunks.add.bind(db.recordingChunks)
    let writes = 0
    // The third chunk does not fit any more.
    vi.spyOn(db.recordingChunks, 'add').mockImplementation(((item: Parameters<typeof add>[0]) => {
      writes += 1
      if (writes === 3) {
        return Promise.reject(
          new DOMException('The quota has been exceeded.', 'QuotaExceededError'),
        )
      }
      return add(item)
    }) as typeof add)
    await startRecording()
    await chunk(5000, 'aaa')
    await chunk(10_000, 'bbb')
    await chunk(15_000, 'ccc', false) // the phone is full

    await until(() => finished !== null)
    expect(finished?.reason).toBe('storage')
    expect(recorder.state.get().savedMs).toBe(10_000)
    const [file] = finished?.rows ?? []
    expect(file).toMatchObject({ name: 'Predica', duration_sec: 10, size_bytes: 6 })
    expect(await (await db.blobs.get(file?.id ?? ''))?.blob.text()).toBe('aaabbb')
    // Later chunks are not written any more; the microphone and the warnings are released.
    current().emit('ddd')
    await settle()
    expect(await db.recordingChunks.count()).toBe(0)
    expect(stream.track.stopped).toBe(true)
    expect(removedBeforeUnload()).toBe(true)
    expect(activeRecording.get().id).toBeNull()
  })

  it('a stop that cannot save releases everything and leaves the chunks for recovery', async () => {
    vi.spyOn(db.files, 'put').mockRejectedValue(new Error('disk error'))
    await startRecording()
    await chunk(5000, 'aaa')
    await chunk(10_000, 'bbb')

    await recorder.stop()
    expect(recorder.state.get()).toMatchObject({ status: 'failed', error: 'save' })
    expect(finished).toBeNull()
    expect(stream.track.stopped).toBe(true)
    expect(recorder.state.get().wakeLock).toBe(false)
    expect(removedBeforeUnload()).toBe(true)
    expect(activeRecording.get().id).toBeNull()
    expect(await db.recordingChunks.count()).toBe(2)
    expect(await db.recordings.count()).toBe(1)
  })

  it('a muted track (iPhone: screen locked, a call) is reported with the minute, recording goes on', async () => {
    await startRecording()
    clock = 754_000 // 12:34
    stream.track.dispatchEvent(new Event('mute'))
    expect(recorder.state.get().interruptions).toEqual([754_000])
    expect(status()).toBe('recording')
    stream.track.dispatchEvent(new Event('unmute'))
    expect(status()).toBe('recording')
  })

  it('no chunk for two intervals while recording is reported once per silence', async () => {
    await startRecording()
    await chunk(5000, 'aaa')
    clock = 5000 + SILENCE_MS + 1
    recorder.tick()
    recorder.tick()
    expect(recorder.state.get().interruptions).toEqual([5000])

    await chunk(60_000, 'bbb') // chunks are back
    clock = 60_000 + SILENCE_MS + 1
    recorder.tick()
    expect(recorder.state.get().interruptions).toEqual([5000, 60_000])
    expect(status()).toBe('recording')
  })

  it('a pause is not a silence, and its row stays fresh for the other tabs', async () => {
    await startRecording()
    await chunk(5000, 'aaa')
    recorder.pause()
    const [row] = await db.recordings.toArray()
    await db.recordings.update(row?.id ?? '', { updated_at: 0 })

    clock = 5000 + 60_000
    recorder.tick()
    await until(async () => ((await db.recordings.get(row?.id ?? ''))?.updated_at ?? 0) > 0)
    expect(recorder.state.get().interruptions).toEqual([])
  })
})

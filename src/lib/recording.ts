import { t } from '@/i18n/ro'

/** A part is closed as its own file at 45 MB, safely under the 50 MB limit (docs/PLAN.md §5.6). */
export const SPLIT_BYTES = 45 * 1024 * 1024
/** Each chunk reaches IndexedDB within 5 s, so an interruption loses at most that much. */
export const CHUNK_MS = 5000
/** Voice bitrate; Safari may ignore it (to be measured on the iPhone). */
export const AUDIO_BITS_PER_SECOND = 48_000

/** WebM/Opus where supported (Chrome, Firefox, Android), MP4/AAC on Safari. */
const PREFERRED_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

export function pickRecordingMime(isTypeSupported: (type: string) => boolean): string | null {
  return PREFERRED_TYPES.find((type) => isTypeSupported(type)) ?? null
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "Înregistrare 2026-10-04 14-32" (local time). */
export function defaultRecordingName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return t.recorder.defaultName(`${day} ${pad(date.getHours())}-${pad(date.getMinutes())}`)
}

/**
 * The file name of a part: the plain name for a recording that was never split,
 * "Nume – Partea N" as soon as it has more than one part.
 */
export function partFileName(name: string, part: number, split: boolean): string {
  return split ? t.recorder.partName(name, part) : name
}

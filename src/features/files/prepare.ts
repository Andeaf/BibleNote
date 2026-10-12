import type { NewFile } from '@/data/files'
import { t } from '@/i18n/ro'
import {
  IMAGE_MAX_SIDE,
  IMAGE_QUALITY,
  fileKind,
  fitWithin,
  isTooLarge,
  jpegName,
  megabytes,
} from '@/lib/files'

/**
 * Turns picked files into what goes into the upload queue: images compressed (only the
 * compressed variant is kept, transparent PNGs on white), audio with its duration, the 50 MB
 * limit checked before anything is queued. Refused files come back as messages.
 */
export async function prepareFiles(
  files: readonly File[],
): Promise<{ ready: NewFile[]; refused: string[] }> {
  const ready: NewFile[] = []
  const refused: string[] = []
  for (const file of files) {
    const mime = file.type || 'application/octet-stream'
    const kind = fileKind(mime)
    if (kind === 'image') {
      const blob = await compressImage(file)
      if (!blob) {
        refused.push(t.files.unreadableImage(file.name))
        continue
      }
      if (isTooLarge(blob.size)) {
        refused.push(t.files.tooLarge(file.name, megabytes(blob.size)))
        continue
      }
      ready.push({ name: jpegName(file.name), kind, mime: 'image/jpeg', blob, durationSec: null })
      continue
    }
    if (isTooLarge(file.size)) {
      refused.push(t.files.tooLarge(file.name, megabytes(file.size)))
      continue
    }
    const durationSec = kind === 'audio' ? await audioDuration(file) : null
    ready.push({ name: file.name, kind, mime, blob: file, durationSec })
  }
  return { ready, refused }
}

/** Decodes with createImageBitmap, or through <img> (Safari decodes HEIC there). */
async function decodeImage(
  file: Blob,
): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file)
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

/** Longest side 2048 px, JPEG 0.82, white behind transparency. Null when it cannot be read. */
export async function compressImage(file: Blob): Promise<Blob | null> {
  let source: CanvasImageSource & { width: number; height: number }
  try {
    source = await decodeImage(file)
  } catch {
    return null
  }
  const [width, height] = fitWithin(source.width, source.height, IMAGE_MAX_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  if ('close' in source && typeof source.close === 'function') source.close()
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', IMAGE_QUALITY))
}

/** Duration from the file's metadata; null when the browser cannot tell (e.g. WebM). */
export function audioDuration(file: Blob, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    const url = URL.createObjectURL(file)
    const done = (value: number | null) => {
      clearTimeout(timer)
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
    audio.onerror = () => done(null)
    audio.src = url
  })
}

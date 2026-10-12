import type { FileKind } from './database.types'

/** The free plan's per-object limit; also the bucket's file_size_limit (52428800). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024

/** Images are kept only compressed: longest side 2048 px, JPEG quality 0.82 (§5.5). */
export const IMAGE_MAX_SIDE = 2048
export const IMAGE_QUALITY = 0.82

const MB = 1024 * 1024

export const storagePath = (spaceId: string, fileId: string): string => `${spaceId}/${fileId}`

export function fileKind(mime: string): FileKind {
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  return 'document'
}

export const isPdf = (mime: string, name = ''): boolean =>
  mime === 'application/pdf' || /\.pdf$/i.test(name)

export const isTooLarge = (bytes: number): boolean => bytes > MAX_FILE_BYTES

/** Whole megabytes for the "too large" message: 72 MB, limita e 50 MB. */
export const megabytes = (bytes: number): number => Math.max(1, Math.round(bytes / MB))

/** Scales (width, height) down to fit `max` on the longest side; never scales up. */
export function fitWithin(width: number, height: number, max: number): [number, number] {
  const longest = Math.max(width, height)
  if (longest <= max) return [width, height]
  const scale = max / longest
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))]
}

/** "poza.HEIC" → "poza.jpg": the name of a compressed image. */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]{1,5}$/, '')
  return `${base || 'imagine'}.jpg`
}

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

/**
 * The name to save a file under: a renamed file ("Predica de duminică") gets its extension back
 * from the type, so the computer knows how to open it.
 */
export function downloadName(name: string, mime: string): string {
  const ext = EXTENSIONS[mime.split(';')[0]?.trim() ?? '']
  if (!ext || new RegExp(`\\.${ext}$`, 'i').test(name)) return name
  if (/\.[a-z0-9]{2,4}$/i.test(name)) return name
  return `${name}.${ext}`
}

const number = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 1 })

/** "820 KB", "3,4 MB", "1,2 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * MB) return `${number.format(bytes / MB)} MB`
  return `${number.format(bytes / (1024 * MB))} GB`
}

/** "0:07", "3:40", "1:02:03". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

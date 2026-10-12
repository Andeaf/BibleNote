import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_BYTES,
  downloadName,
  fileKind,
  fitWithin,
  formatBytes,
  formatDuration,
  isTooLarge,
  jpegName,
  megabytes,
} from './files'

describe('files', () => {
  it('refuses only what is over 50 MB, and names the size in whole MB', () => {
    expect(isTooLarge(MAX_FILE_BYTES)).toBe(false)
    expect(isTooLarge(MAX_FILE_BYTES + 1)).toBe(true)
    expect(megabytes(72 * 1024 * 1024)).toBe(72)
    expect(megabytes(60 * 1024 * 1024 + 1)).toBe(60)
  })

  it('scales images down to 2048 px on the longest side, never up', () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual([2048, 1536])
    expect(fitWithin(3024, 4032, 2048)).toEqual([1536, 2048])
    expect(fitWithin(800, 600, 2048)).toEqual([800, 600])
  })

  it('classifies files by type', () => {
    expect(fileKind('audio/webm;codecs=opus')).toBe('audio')
    expect(fileKind('image/heic')).toBe('image')
    expect(fileKind('application/pdf')).toBe('document')
    expect(fileKind('')).toBe('document')
  })

  it('names compressed images .jpg and gives renamed files their extension back', () => {
    expect(jpegName('IMG_0001.HEIC')).toBe('IMG_0001.jpg')
    expect(jpegName('schiță')).toBe('schiță.jpg')
    expect(downloadName('Înregistrare 2026-10-12 14-32', 'audio/webm;codecs=opus')).toBe(
      'Înregistrare 2026-10-12 14-32.webm',
    )
    expect(downloadName('Predica', 'audio/mp4')).toBe('Predica.m4a')
    expect(downloadName('notițe.pdf', 'application/pdf')).toBe('notițe.pdf')
    expect(downloadName('plan.docx', 'application/octet-stream')).toBe('plan.docx')
  })

  it('formats sizes and durations the Romanian way', () => {
    expect(formatBytes(820 * 1024)).toBe('820 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3,4 MB')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(220)).toBe('3:40')
    expect(formatDuration(3723)).toBe('1:02:03')
  })
})

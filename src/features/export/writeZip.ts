import { downloadZip, makeZip } from 'client-zip'
import { readBlob } from '@/lib/blobs'
import type { BibleNoteDb } from '@/lib/db'
import type { StorageProvider } from '@/lib/storage/StorageProvider'
import type { ExportEntry } from './plan'

/** A file that could not be read (offline, or its download failed): the export stops. */
export class ExportFileError extends Error {
  readonly path: string
  constructor(path: string) {
    super(`export: ${path}`)
    this.path = path
  }
}

interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>
}

/** Chrome and Edge on computers can write the ZIP to disk as it is made (no copy in memory). */
export function canStreamToDisk(): boolean {
  return typeof (window as SavePickerWindow).showSaveFilePicker === 'function'
}

/**
 * Asks where to save the ZIP. Call it first thing in the click handler (browsers allow the
 * dialog only during the click). Null when the user closed the dialog.
 */
export async function pickZipTarget(fileName: string): Promise<WritableStream<Uint8Array> | null> {
  const picker = (window as SavePickerWindow).showSaveFilePicker
  if (!picker) return null
  try {
    const handle = await picker({
      suggestedName: fileName,
      types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }],
    })
    return await handle.createWritable()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

export interface WriteZipOptions {
  entries: ExportEntry[]
  db: BibleNoteDb
  storage: StorageProvider
  fileName: string
  /** Where to stream it (from pickZipTarget); without one the ZIP is made in memory. */
  target: WritableStream<Uint8Array> | null
  /** Phones: offer the ZIP to the share sheet ("Salvează în Fișiere") when possible. */
  preferShare: boolean
  signal: AbortSignal
  onProgress: (done: number) => void
}

/**
 * Makes the ZIP one entry at a time: notes from memory, files from this device's cache or, when
 * missing, downloaded through a signed URL as a stream. Written straight to disk when a target
 * was picked, otherwise collected in memory and saved (only for the notes on phones, see
 * ExportSection). Throws ExportFileError when a file cannot be read, AbortError when cancelled.
 */
export async function writeZip(options: WriteZipOptions): Promise<void> {
  const { entries, db, storage, signal, onProgress } = options
  let done = 0
  async function* inputs() {
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.kind === 'note') {
        yield { name: entry.path, input: entry.text, lastModified: entry.lastModified }
      } else {
        const cached = await readBlob(db, entry.id)
        if (cached) {
          yield { name: entry.path, input: cached, lastModified: entry.lastModified }
        } else {
          let response: Response
          try {
            response = await fetch(await storage.getUrl(entry.storagePath), { signal })
          } catch (error) {
            if (signal.aborted) throw error
            throw new ExportFileError(entry.path)
          }
          if (!response.ok) throw new ExportFileError(entry.path)
          yield {
            name: entry.path,
            input: response,
            lastModified: entry.lastModified,
            size: entry.size,
          }
        }
      }
      onProgress(++done)
    }
  }

  if (options.target) {
    await makeZip(inputs()).pipeTo(options.target, { signal })
    return
  }
  const blob = await downloadZip(inputs()).blob()
  const file = new File([blob], options.fileName, { type: 'application/zip' })
  if (options.preferShare && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: options.fileName })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = options.fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

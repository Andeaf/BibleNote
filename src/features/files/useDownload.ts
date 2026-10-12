import { t } from '@/i18n/ro'
import { readBlob } from '@/lib/blobs'
import type { FileRow } from '@/lib/database.types'
import { downloadName } from '@/lib/files'
import { useSyncRuntime } from '@/sync/SyncContext'

function clickLink(href: string, name: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

/** Saves a file: from this device when it is here, otherwise straight from Storage. */
export function useDownload(): (file: FileRow) => Promise<void> {
  const { db, storage, notify } = useSyncRuntime()
  return async (file) => {
    const name = downloadName(file.name, file.mime)
    const local = await readBlob(db, file.id)
    if (local) {
      const url = URL.createObjectURL(local)
      clickLink(url, name)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return
    }
    try {
      clickLink(await storage.getUrl(file.storage_path, name), name)
    } catch {
      notify({
        kind: 'message',
        text: navigator.onLine ? t.files.downloadFailed : t.common.needsInternet,
      })
    }
  }
}

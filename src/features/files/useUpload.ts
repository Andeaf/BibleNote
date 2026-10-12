import { useState } from 'react'
import { addFiles } from '@/data/files'
import { useSyncRuntime } from '@/sync/SyncContext'
import { prepareFiles } from './prepare'

/**
 * Puts picked or dropped files into the upload queue of a folder: compressed and checked first,
 * refused ones reported. Works offline; the engine uploads when it can.
 */
export function useUpload(spaceId: string, folderId: string | null) {
  const { db, engine, userId, notify } = useSyncRuntime()
  const [busy, setBusy] = useState(false)

  async function upload(list: FileList | readonly File[] | null) {
    const files = list ? Array.from(list) : []
    if (files.length === 0) return
    setBusy(true)
    try {
      const { ready, refused } = await prepareFiles(files)
      for (const text of refused) notify({ kind: 'message', text })
      if (ready.length > 0) {
        await addFiles(db, userId, spaceId, folderId, ready)
        engine.requestPush(0)
      }
    } finally {
      setBusy(false)
    }
  }

  return { upload, busy }
}

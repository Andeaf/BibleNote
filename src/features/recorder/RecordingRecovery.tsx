import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useSyncExternalStore } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { discardRecording, finishRecording } from '@/data/recordings'
import { useNow } from '@/features/notes/hooks'
import { t } from '@/i18n/ro'
import { formatDuration } from '@/lib/files'
import { useSyncRuntime } from '@/sync/SyncContext'
import { activeRecording } from './AudioRecorder'

/** A recording still receiving chunks (every 5 s) may belong to another open tab: leave it. */
const QUIET_MS = 30_000

/**
 * "Ai o înregistrare neterminată (3:40). Salvează / Renunță": shown at start when the app was
 * closed (or the phone died) during a recording. Saving turns the chunks kept in IndexedDB
 * into files in the upload queue.
 */
export function RecordingRecovery() {
  const { db, engine, userId, notify } = useSyncRuntime()
  const active = useSyncExternalStore(activeRecording.subscribe, activeRecording.get)
  const recordings = useLiveQuery(() => db.recordings.toArray(), [db])
  const now = useNow(10_000)
  const [later, setLater] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const recording = recordings?.find(
    (r) => r.id !== active.id && !later.includes(r.id) && now - r.updated_at > QUIET_MS,
  )
  if (!recording) return null

  async function save() {
    if (!recording) return
    setBusy(true)
    try {
      const rows = await finishRecording(db, userId, recording.id)
      engine.requestPush(0)
      if (rows[0]) notify({ kind: 'message', text: t.recorder.saved(rows[0].name) })
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!recording) return
    await discardRecording(db, recording.id)
    setConfirming(false)
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) setLater((ids) => [...ids, recording.id])
      }}
      title={confirming ? t.recorder.discardTitle : t.recorder.recoverTitle}
    >
      <p className="text-sm text-muted">
        {confirming
          ? t.recorder.discardHint
          : t.recorder.recoverHint(recording.name, formatDuration(recording.elapsed_ms / 1000))}
      </p>
      <div className="mt-6 flex justify-end gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirming(false)}
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              className="btn bg-danger text-white hover:brightness-110"
              onClick={() => void discard()}
            >
              {t.recorder.discard}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary text-danger"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              {t.recorder.discard}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={busy}
            >
              {t.common.save}
            </button>
          </>
        )}
      </div>
    </Dialog>
  )
}

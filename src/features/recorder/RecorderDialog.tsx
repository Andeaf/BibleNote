import { Mic, Pause, Play, Square } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { discardRecording } from '@/data/recordings'
import { t } from '@/i18n/ro'
import { formatDuration } from '@/lib/files'
import { defaultRecordingName } from '@/lib/recording'
import { useSyncRuntime } from '@/sync/SyncContext'
import { AudioRecorder } from './AudioRecorder'

interface RecorderDialogProps {
  spaceId: string
  folderId: string | null
  onClose: () => void
}

const ERRORS = {
  denied: t.recorder.micDenied,
  unsupported: t.recorder.unsupported,
  failed: t.recorder.failed,
} as const

/**
 * "Înregistrare audio": big button, timer, pause/resume, name with date and time. The dialog
 * cannot be dismissed while recording; leaving the page (Android back) saves what was recorded.
 */
export function RecorderDialog({ spaceId, folderId, onClose }: RecorderDialogProps) {
  const { db, engine, userId, notify } = useSyncRuntime()
  const [name, setName] = useState(() => defaultRecordingName(new Date()))
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [recorder] = useState(() => new AudioRecorder(db, userId))
  const state = useSyncExternalStore(recorder.state.subscribe, recorder.state.get)

  function start() {
    void recorder.start({ spaceId, folderId, name }, (rows, interrupted) => {
      engine.requestPush(0)
      notify({
        kind: 'message',
        text: interrupted ? t.recorder.interrupted : t.recorder.saved(rows[0]?.name ?? name),
      })
      onClose()
    })
  }
  const active = state.status === 'recording' || state.status === 'paused'
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setElapsed(recorder.elapsedMs()), 250)
    return () => clearInterval(timer)
  }, [active, recorder])

  // Leaving the page while recording keeps the recording: it is saved, never lost.
  useEffect(() => () => void recorder.stop(), [recorder])

  async function discard() {
    const id = recorder.cancel()
    if (id) await discardRecording(db, id)
    onClose()
  }

  const busy = state.status === 'starting' || state.status === 'saving'
  const seconds = (active || state.status === 'saving' ? elapsed : 0) / 1000

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !active && !busy) onClose()
      }}
      dismissible={!active && !busy}
      title={t.recorder.title}
    >
      {confirmDiscard ? (
        <div>
          <p className="font-medium">{t.recorder.discardTitle}</p>
          <p className="mt-1 text-sm text-muted">{t.recorder.discardHint}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmDiscard(false)}
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
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <label className="block w-full">
            <span className="block text-sm font-medium">{t.recorder.nameLabel}</span>
            <input
              className="input mt-1 w-full"
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => recorder.rename(name)}
              disabled={state.status === 'saving'}
            />
          </label>

          <p className="font-mono text-5xl font-semibold tabular-nums" role="timer" aria-live="off">
            {formatDuration(seconds)}
          </p>
          <p className="flex min-h-6 items-center gap-2 text-sm text-muted" role="status">
            {state.status === 'recording' && (
              <span className="size-2.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
            )}
            {state.status === 'recording' && t.recorder.recording}
            {state.status === 'paused' && t.recorder.paused}
            {state.status === 'saving' && t.common.loading}
            {state.part > 1 && active && ` · ${t.recorder.part(state.part)}`}
          </p>

          {state.status === 'idle' || state.status === 'starting' ? (
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="flex size-24 items-center justify-center rounded-full bg-danger text-white shadow-lg hover:brightness-110 disabled:opacity-60"
              aria-label={t.recorder.start}
            >
              <Mic className="size-10" aria-hidden="true" />
            </button>
          ) : (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => (state.status === 'paused' ? recorder.resume() : recorder.pause())}
                disabled={!active}
                className="flex size-16 items-center justify-center rounded-full border border-line bg-surface hover:bg-canvas disabled:opacity-60"
                aria-label={state.status === 'paused' ? t.recorder.resume : t.recorder.pause}
              >
                {state.status === 'paused' ? (
                  <Play className="size-7" aria-hidden="true" />
                ) : (
                  <Pause className="size-7" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void recorder.stop()}
                disabled={!active}
                className="flex size-24 items-center justify-center rounded-full bg-danger text-white shadow-lg hover:brightness-110 disabled:opacity-60"
                aria-label={t.recorder.stop}
              >
                <Square className="size-9 fill-current" aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="text-center text-sm font-medium">
            {state.status === 'idle' || state.status === 'starting'
              ? t.recorder.start
              : t.recorder.stop}
          </p>

          {state.error && (
            <p className="w-full rounded-xl border border-line px-3 py-2 text-sm text-danger">
              {ERRORS[state.error]}
            </p>
          )}
          {active && (
            <p className="text-center text-sm text-muted">
              {state.wakeLock ? t.recorder.screenStaysOn : t.recorder.keepScreenOn}
            </p>
          )}
          {active && (
            <button
              type="button"
              className="btn btn-secondary text-danger"
              onClick={() => setConfirmDiscard(true)}
            >
              {t.recorder.discard}
            </button>
          )}
        </div>
      )}
    </Dialog>
  )
}

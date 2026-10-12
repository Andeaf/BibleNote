import { useSyncExternalStore } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { activeRecording } from '@/features/recorder/AudioRecorder'
import { t } from '@/i18n/ro'
import { NoticeStack } from './NoticeStack'

/**
 * Shown when a new service worker is waiting. The app never reloads on its own,
 * so an in-progress recording or an unsaved edit is never interrupted; while this tab records,
 * the prompt waits.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const recording = useSyncExternalStore(activeRecording.subscribe, activeRecording.get)

  if (!needRefresh || recording.id) return null

  return (
    <NoticeStack>
      <div
        role="status"
        className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg"
      >
        <p className="flex-1 text-sm">{t.pwa.updateTitle}</p>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-muted hover:text-ink"
        >
          {t.pwa.later}
        </button>
        <button
          type="button"
          onClick={() => void updateServiceWorker(true)}
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white"
        >
          {t.pwa.reload}
        </button>
      </div>
    </NoticeStack>
  )
}

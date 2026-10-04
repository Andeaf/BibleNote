import { useRegisterSW } from 'virtual:pwa-register/react'
import { t } from '@/i18n/ro'

/**
 * Shown when a new service worker is waiting. The app never reloads on its own,
 * so an in-progress recording or an unsaved edit is never interrupted.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg lg:bottom-6"
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
  )
}

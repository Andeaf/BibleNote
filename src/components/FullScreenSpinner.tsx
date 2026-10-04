import { Loader2 } from 'lucide-react'
import { t } from '@/i18n/ro'

export function FullScreenSpinner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 text-muted"
    >
      <Loader2 className="size-6 animate-spin" aria-hidden="true" />
      <span className="text-sm">{t.common.loading}</span>
    </div>
  )
}

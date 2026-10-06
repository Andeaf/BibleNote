import { useState } from 'react'
import { t } from '@/i18n/ro'
import { Dialog } from './Dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

/** Every destructive action asks first. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()} title={title}>
      <p className="text-sm text-muted">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className={`btn ${destructive ? 'bg-danger text-white hover:brightness-110' : 'btn-primary'}`}
          onClick={() => void confirm()}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

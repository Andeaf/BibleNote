import { useState, type FormEvent } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { t } from '@/i18n/ro'

interface RenameDialogProps {
  open: boolean
  title: string
  initial: string
  onClose: () => void
  onSubmit: (name: string) => Promise<void> | void
}

export function RenameDialog({ open, title, initial, onClose, onSubmit }: RenameDialogProps) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      <form onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-medium" htmlFor="bn-rename">
          {t.folders.nameLabel}
        </label>
        <input
          id="bn-rename"
          className="input mt-1 w-full"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          maxLength={200}
        />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {t.common.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            {t.common.save}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

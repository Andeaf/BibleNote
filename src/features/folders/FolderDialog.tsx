import { useState, type FormEvent } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { t } from '@/i18n/ro'
import { FolderIcon } from './FolderIcon'
import { DEFAULT_COLOR, FOLDER_COLORS, FOLDER_EMOJIS } from './palette'

export interface FolderFormValue {
  name: string
  color: string | null
  emoji: string | null
}

interface FolderDialogProps {
  open: boolean
  title: string
  initial?: FolderFormValue
  submitLabel: string
  onClose: () => void
  onSubmit: (value: FolderFormValue) => Promise<void> | void
}

/** Create or edit a main folder / subfolder: name, emoji and colour, with a live preview. */
export function FolderDialog({
  open,
  title,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: FolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={title}>
      {open && (
        <FolderForm
          key={initial ? `${initial.name}|${initial.color}|${initial.emoji}` : 'new'}
          initial={initial}
          submitLabel={submitLabel}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      )}
    </Dialog>
  )
}

function FolderForm({
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: Omit<FolderDialogProps, 'open' | 'title'>) {
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState<string>(initial?.color ?? DEFAULT_COLOR)
  const [emoji, setEmoji] = useState<string | null>(initial?.emoji ?? null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), color, emoji })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <FolderIcon emoji={emoji} color={color} size="lg" />
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">{t.folders.nameLabel}</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="input"
          />
        </label>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t.folders.colorLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {FOLDER_COLORS.map((value, index) => (
            <button
              key={value}
              type="button"
              onClick={() => setColor(value)}
              aria-label={t.folders.colorOption(index + 1)}
              aria-pressed={color === value}
              className={`size-11 rounded-full border-4 ${
                color === value ? 'border-ink' : 'border-transparent'
              }`}
              style={{ background: value }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t.folders.emojiLabel}</legend>
        <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
          <button
            type="button"
            onClick={() => setEmoji(null)}
            aria-label={t.folders.noEmoji}
            aria-pressed={emoji === null}
            className={`flex size-11 items-center justify-center rounded-lg text-xl ${
              emoji === null ? 'bg-accent-soft' : 'hover:bg-canvas'
            }`}
          >
            📁
          </button>
          {FOLDER_EMOJIS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setEmoji(value)}
              aria-label={value}
              aria-pressed={emoji === value}
              className={`flex size-11 items-center justify-center rounded-lg text-xl ${
                emoji === value ? 'bg-accent-soft' : 'hover:bg-canvas'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          {t.common.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

import { ExternalLink } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { t } from '@/i18n/ro'
import { normalizeUrl } from './extensions'

interface LinkDialogProps {
  open: boolean
  /** The link under the cursor, if any. */
  href: string
  onClose: () => void
  onApply: (href: string) => void
  onRemove: () => void
}

/** Adds, changes or removes the link at the cursor; "Deschide linkul" opens it in a new tab. */
export function LinkDialog({ open, href, onClose, onApply, onRemove }: LinkDialogProps) {
  const [value, setValue] = useState(href)
  const url = normalizeUrl(value)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (url) onApply(url)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={t.editor.link}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t.editor.linkUrl}
          <input
            className="input"
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://"
            autoFocus
          />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {href && (
            <>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary mr-auto"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {t.editor.linkOpen}
              </a>
              <button type="button" className="btn btn-secondary text-danger" onClick={onRemove}>
                {t.editor.linkRemove}
              </button>
            </>
          )}
          <button type="submit" className="btn btn-primary" disabled={!url}>
            {t.editor.linkApply}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

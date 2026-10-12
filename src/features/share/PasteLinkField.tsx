import { Link2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { t } from '@/i18n/ro'
import { joinPath } from '@/lib/paths'
import { extractShareToken } from '@/lib/shareLink'

/**
 * "Ai primit un link? Lipește-l aici": the installed app on the iPhone has no address bar and
 * keeps its data apart from Safari, so a link received in a message is pasted here.
 */
export function PasteLinkField({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const id = useId()
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)

  function submit(event: FormEvent) {
    event.preventDefault()
    const token = extractShareToken(text)
    if (!token) {
      setInvalid(true)
      return
    }
    void navigate(joinPath(token))
  }

  return (
    <form onSubmit={submit} className={className}>
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Link2 className="size-4 text-muted" aria-hidden="true" />
        {t.share.pasteLabel}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setInvalid(false)
          }}
          aria-invalid={invalid}
          className="input min-w-0 flex-1"
        />
        <button type="submit" className="btn btn-secondary shrink-0" disabled={!text.trim()}>
          {t.share.pasteOpen}
        </button>
      </div>
      {invalid && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {t.share.pasteInvalid}
        </p>
      )}
    </form>
  )
}

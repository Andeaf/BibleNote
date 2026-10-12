import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { t } from '@/i18n/ro'
import { displayName } from './books'
import { chapterCount, formatRef, parseQuery, suggestBooks, type BibleRef } from './parser'
import { Passage } from './Passage'
import { useVerses, type VerseText } from './text'

interface VerseDialogProps {
  onClose: () => void
  onInsert: (ref: BibleRef, verses: VerseText[]) => void
}

/**
 * The "Verset" button of the toolbar: type a reference loosely ("ioan 3 16", "ps 23", a chapter
 * of any book), see the text, insert it as a quote. While only a name is typed, the matching
 * books are offered.
 */
export function VerseDialog({ onClose, onInsert }: VerseDialogProps) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const ref = useMemo(() => parseQuery(query), [query])
  const books = useMemo(() => (ref ? [] : suggestBooks(query)), [query, ref])
  const state = useVerses(ref)
  // Not while a separator was just typed ("Ioan 3:"): the rest is still coming.
  const notFound = !ref && books.length === 0 && /[\p{L}\p{N}]$/u.test(query.trim())

  function submit(event: FormEvent) {
    event.preventDefault()
    if (ref && state.status === 'ready') onInsert(ref, state.verses)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t.editor.verse}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t.bible.referenceLabel}
          <input
            ref={input}
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.bible.referencePlaceholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            autoFocus
          />
        </label>

        {books.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted">{t.bible.books}</h3>
            <ul className="flex flex-wrap gap-2">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setQuery(`${displayName(book)} `)
                      input.current?.focus()
                    }}
                  >
                    {displayName(book)}
                    <span className="text-xs font-normal text-muted">
                      {t.bible.chapters(chapterCount(book.id))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!query.trim() && <p className="text-sm text-muted">{t.bible.referenceHint}</p>}
        {notFound && (
          <p role="status" className="text-sm text-muted">
            {t.bible.notFound}
          </p>
        )}

        {ref && (
          <section aria-label={formatRef(ref)} className="rounded-xl border border-line">
            <h3 className="border-b border-line px-4 py-2 font-semibold">{formatRef(ref)}</h3>
            <div className="max-h-[40dvh] overflow-y-auto px-4 py-3">
              <Passage reference={ref} state={state} />
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!ref || state.status !== 'ready'}
          >
            {t.bible.insert}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

import { Search } from 'lucide-react'
import { useDeferredValue, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { useAllNotes, useLocator, useNow } from '@/features/notes/hooks'
import { NoteRowItem } from '@/features/notes/NoteRowItem'
import { t } from '@/i18n/ro'
import { searchNotes, snippetOf } from './searchIndex'

const SHOWN = 50

/**
 * Instant search over the notes on this device (works offline), ignoring case and diacritics.
 * The query lives in the address (?q=) so "Înapoi" from a note comes back to the same results.
 */
export function SearchPage() {
  const notes = useAllNotes()
  const locate = useLocator()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const deferred = useDeferredValue(query)
  const hits = useMemo(() => (notes ? searchNotes(notes, deferred) : []), [notes, deferred])
  const searching = deferred.trim().length > 0

  return (
    <>
      <PageHeader title={t.search.title} />
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
        <label className="relative block">
          <span className="sr-only">{t.search.label}</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) =>
              setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })
            }
            placeholder={t.search.placeholder}
            enterKeyHint="search"
            autoFocus
            className="input w-full pl-10"
          />
        </label>

        {!searching ? (
          <EmptyState icon={Search} title={t.search.title} hint={t.search.empty} />
        ) : hits.length === 0 ? (
          <p className="mt-8 text-center text-muted" role="status">
            {t.search.noResults(deferred.trim())}
          </p>
        ) : (
          <>
            <p className="mt-4 mb-2 text-sm text-muted" role="status">
              {t.search.results(hits.length)}
            </p>
            <ul className="flex flex-col gap-1">
              {hits.slice(0, SHOWN).map(({ note }) => (
                <li key={note.id}>
                  <NoteRowItem
                    note={note}
                    now={now}
                    location={locate(note)}
                    snippet={snippetOf(note.content_text, deferred)}
                  />
                </li>
              ))}
            </ul>
            {hits.length > SHOWN && (
              <p className="mt-3 text-center text-sm text-muted">{t.search.moreResults(SHOWN)}</p>
            )}
          </>
        )}
      </div>
    </>
  )
}

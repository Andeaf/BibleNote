import { Tag } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { sortNotes } from '@/data/tree'
import { useSortMode } from '@/features/folders/hooks'
import { SortToggle } from '@/features/folders/SortToggle'
import { useAllNotes, useLocator, useNow } from '@/features/notes/hooks'
import { NoteRowItem } from '@/features/notes/NoteRowItem'
import { t } from '@/i18n/ro'
import { tagPath } from '@/lib/paths'
import { collectTags, tagColor, tagKey } from '@/lib/tags'

/** Every tag in use across the main folders this account can reach, with its note count. */
export function TagsPage() {
  const notes = useAllNotes()
  const tags = useMemo(() => collectTags(notes ?? []), [notes])

  return (
    <>
      <PageHeader title={t.tags.title} />
      <div className="mx-auto max-w-4xl px-4 py-4 lg:px-6">
        {notes === undefined ? null : tags.length === 0 ? (
          <EmptyState icon={Tag} title={t.tags.title} hint={t.tags.empty} />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((use) => (
              <li key={use.key}>
                <Link
                  to={tagPath(use.tag)}
                  className={`bn-tag bn-tag-${tagColor(use.tag)} flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium`}
                >
                  <span>#{use.tag}</span>
                  <span className="text-xs opacity-80">{use.count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** The notes with one tag, from every main folder, pinned first. */
export function TagNotesPage() {
  const { tag = '' } = useParams()
  const notes = useAllNotes()
  const locate = useLocator()
  const now = useNow()
  const [sort, setSort] = useSortMode()
  const key = tagKey(tag)
  const tagged = useMemo(
    () =>
      sortNotes(
        (notes ?? []).filter((n) => n.tags.some((other) => tagKey(other) === key)),
        sort,
      ),
    [notes, key, sort],
  )

  return (
    <>
      <PageHeader
        title={`#${tag}`}
        backTo="/tags"
        actions={<SortToggle mode={sort} onChange={setSort} />}
      />
      <div className="mx-auto max-w-4xl px-4 py-4 lg:px-6">
        {notes === undefined ? null : tagged.length === 0 ? (
          <EmptyState icon={Tag} title={`#${tag}`} hint={t.tags.noNotes} />
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">{t.tags.count(tagged.length)}</p>
            <ul className="flex flex-col gap-1">
              {tagged.map((note) => (
                <li key={note.id}>
                  <NoteRowItem note={note} now={now} location={locate(note)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}

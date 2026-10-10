import { FileText, Pin } from 'lucide-react'
import type { HTMLAttributes, Ref } from 'react'
import { Link } from 'react-router'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import type { Snippet } from '@/features/search/searchIndex'
import { TagChip } from '@/features/tags/TagChip'
import { t } from '@/i18n/ro'
import type { NoteRow } from '@/lib/database.types'
import { notePath } from '@/lib/paths'
import { formatRelative } from '@/lib/time'

interface NoteRowItemProps {
  note: NoteRow
  now: number
  /** "Folder principal › Subfolder", where the note lives (search and tag lists). */
  location?: string
  /** Search result: the text around the match. */
  snippet?: Snippet | null
  menu?: MenuItem[]
  /** Drag source on desktop (dnd-kit), spread on the link. */
  dragRef?: Ref<HTMLAnchorElement>
  dragProps?: HTMLAttributes<HTMLAnchorElement>
  className?: string
}

/** One note in a list: title, first line or search snippet, tags, when it changed. */
export function NoteRowItem({
  note,
  now,
  location,
  snippet,
  menu,
  dragRef,
  dragProps,
  className = '',
}: NoteRowItemProps) {
  const title = note.title.trim()
  const firstLine = note.content_text.trim().split('\n')[0]?.slice(0, 160)
  const when = formatRelative(note.updated_at, now) ?? t.notes.justNow
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-line bg-surface pr-1 pl-3 ${className}`}
    >
      <Link
        ref={dragRef}
        {...dragProps}
        to={notePath(note.id)}
        className="flex min-h-14 min-w-0 flex-1 items-start gap-3 py-2.5 touch-manipulation"
      >
        {note.pinned ? (
          <Pin className="mt-0.5 size-5 shrink-0 text-accent" aria-label={t.notes.pinned} />
        ) : (
          <FileText className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${title ? '' : 'text-muted'}`}>
            {title || t.notes.untitled}
          </span>
          {snippet ? (
            <span className="mt-0.5 line-clamp-2 text-sm text-muted">
              {snippet.before}
              <mark className="rounded-sm bg-accent-soft px-0.5 text-ink">{snippet.match}</mark>
              {snippet.after}
            </span>
          ) : (
            firstLine && (
              <span className="mt-0.5 block truncate text-sm text-muted">{firstLine}</span>
            )
          )}
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {location && <span className="max-w-full truncate">{location}</span>}
            {location && <span aria-hidden="true">·</span>}
            <span>{when}</span>
            {note.tags.slice(0, 3).map((tag) => (
              <TagChip key={tag} tag={tag} small />
            ))}
          </span>
        </span>
      </Link>
      {menu && <Menu label={`${t.common.menu}: ${title || t.notes.untitled}`} items={menu} />}
    </div>
  )
}

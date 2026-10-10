import { t } from '@/i18n/ro'
import type { NoteRow } from '@/lib/database.types'
import { formatRelative } from '@/lib/time'
import { useAuthorName, useNow } from './hooks'

/** "Modificat de Ana, acum 5 minute": updated_by and the server's updated_at. */
export function ModifiedBy({ note }: { note: NoteRow }) {
  const now = useNow()
  const name = useAuthorName(note.updated_by, note.space_id)
  const when = formatRelative(note.updated_at, now) ?? t.notes.justNow
  return <p className="mt-2 text-xs text-muted">{t.notes.modifiedBy(name, when)}</p>
}

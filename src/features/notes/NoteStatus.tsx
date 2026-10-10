import { AlertTriangle, Check, CloudOff, Eye, RefreshCw, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import { useSyncState } from '@/sync/SyncContext'
import { useNoteSyncState } from './hooks'

interface NoteStatusProps {
  noteId: string
  /** The editor has typing not yet written to Dexie. */
  dirty: boolean
  readOnly: boolean
}

/**
 * "Salvat" / "Se salvează…" / "Offline – se sincronizează automat", from this note's outbox
 * entries and the connection; "Nesincronizat" (a link to Settings) when its change failed.
 * Lives in the header row, in place of the global sync indicator. Short text on phones.
 */
export function NoteStatus({ noteId, dirty, readOnly }: NoteStatusProps) {
  const sync = useNoteSyncState(noteId)
  const { online } = useSyncState()

  let icon: LucideIcon = Check
  let text: string = t.notes.saved
  let short: string = text
  let tone = 'text-muted'
  if (readOnly) {
    icon = Eye
    text = short = t.notes.readOnly
  } else if (sync === 'failed') {
    icon = AlertTriangle
    text = short = t.notes.unsynced
    tone = 'text-danger'
  } else if (dirty || sync === 'pending') {
    if (online) {
      icon = RefreshCw
      text = short = t.notes.saving
    } else {
      icon = CloudOff
      text = t.notes.offline
      short = t.notes.offlineShort
    }
  }
  const Icon = icon
  const body = (
    <>
      <Icon
        className={`size-4 shrink-0 ${icon === RefreshCw ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{text}</span>
    </>
  )
  const className = `flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium ${tone}`
  return sync === 'failed' && !readOnly ? (
    <Link to="/settings" className={className} aria-label={text}>
      {body}
    </Link>
  ) : (
    <span className={className} aria-label={text} title={text}>
      {body}
    </span>
  )
}

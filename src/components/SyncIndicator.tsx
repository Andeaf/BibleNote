import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CloudOff, RefreshCw } from 'lucide-react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import { useDb, useSyncState } from '@/sync/SyncContext'

interface SyncIndicatorProps {
  /** `bar`: text row for the sidebar. `pill`: compact floating badge for phones. */
  variant: 'bar' | 'pill'
}

/**
 * Three states worth showing: offline, changes that failed (link to Settings), and work in
 * progress. When everything is synced the bar says so quietly and the pill disappears.
 */
export function SyncIndicator({ variant }: SyncIndicatorProps) {
  const db = useDb()
  const state = useSyncState()
  const counts = useLiveQuery(async () => {
    const entries = await db.outbox.toArray()
    const failed = entries.filter((e) => e.status === 'failed').length
    return { failed, pending: entries.length - failed }
  }, [db])
  const failed = counts?.failed ?? 0
  const pending = counts?.pending ?? 0
  const busy = pending > 0 || state.pushing || state.pulling

  let content: { icon: typeof CloudOff; text: string; tone: string; to?: string } | null = null
  if (failed > 0) {
    content = {
      icon: AlertTriangle,
      text: t.sync.failedCount(failed),
      tone: 'text-danger',
      to: '/settings',
    }
  } else if (!state.online) {
    content = { icon: CloudOff, text: t.sync.offline, tone: 'text-muted' }
  } else if (busy) {
    content = { icon: RefreshCw, text: t.sync.syncing, tone: 'text-muted' }
  } else if (variant === 'bar') {
    content = { icon: RefreshCw, text: t.sync.upToDate, tone: 'text-muted' }
  }
  if (!content) return null

  const Icon = content.icon
  const spin = busy && content.icon === RefreshCw ? 'animate-spin' : ''
  const base =
    variant === 'bar'
      ? `flex min-h-11 items-center gap-2 px-3 text-xs ${content.tone}`
      : `fixed top-3 right-3 z-20 flex min-h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs shadow ${content.tone} lg:hidden`
  const body = (
    <>
      <Icon className={`size-4 ${spin}`} aria-hidden="true" />
      <span>{content.text}</span>
    </>
  )
  return content.to ? (
    <Link to={content.to} className={base}>
      {body}
    </Link>
  ) : (
    <div className={base} role="status">
      {body}
    </div>
  )
}

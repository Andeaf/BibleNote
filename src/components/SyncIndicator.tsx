import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CloudOff, RefreshCw, UploadCloud, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import { useDb, useSyncState } from '@/sync/SyncContext'

interface SyncIndicatorProps {
  /**
   * `bar`: text row at the bottom of the desktop sidebar.
   * `icon`: 44 px icon placed in the page header row on phones. It is part of the row's layout
   * (never floating), so it cannot cover a button, and it has the same size in every state.
   */
  variant: 'bar' | 'icon'
}

interface IndicatorContent {
  icon: LucideIcon
  text: string
  tone: string
  spin: boolean
  to?: string
  count?: number
  /** Upload progress, shown under the phone icon. */
  percent?: number
}

/**
 * The states worth showing: changes that failed (link to Settings), offline (only when there is
 * really no connection), file uploads on their own ("Se încarcă 2 fișiere · 45%", "1 fișier
 * așteaptă conexiunea") and other work in progress. When everything is synced the bar says so
 * quietly and the icon disappears.
 */
export function SyncIndicator({ variant }: SyncIndicatorProps) {
  const db = useDb()
  const state = useSyncState()
  const counts = useLiveQuery(async () => {
    const entries = await db.outbox.toArray()
    const failed = entries.filter((e) => e.status === 'failed').length
    // Files still being transferred are counted apart; their rows are ordinary pending work.
    const uploads = entries.filter(
      (e) => e.status !== 'failed' && e.op === 'upload' && !e.uploaded,
    ).length
    return { failed, uploads, pending: entries.length - failed - uploads }
  }, [db])
  const failed = counts?.failed ?? 0
  const pending = counts?.pending ?? 0
  const uploads = counts?.uploads ?? 0
  const busy = pending > 0 || state.pushing || state.pulling
  const transfer = state.transfer
  const percent = transfer
    ? Math.min(99, Math.floor((transfer.loaded / Math.max(1, transfer.total)) * 100))
    : 0

  let content: IndicatorContent | null = null
  if (failed > 0) {
    content = {
      icon: AlertTriangle,
      text: t.sync.failedCount(failed),
      tone: 'text-danger',
      spin: false,
      to: '/settings',
      count: failed,
    }
  } else if (!state.online) {
    content = { icon: CloudOff, text: t.sync.offline, tone: 'text-muted', spin: false }
  } else if (transfer) {
    content = {
      icon: UploadCloud,
      text: t.sync.uploading(Math.max(1, uploads), percent),
      tone: 'text-accent',
      spin: false,
      percent,
    }
  } else if (busy) {
    content = { icon: RefreshCw, text: t.sync.syncing, tone: 'text-muted', spin: true }
  } else if (uploads > 0) {
    content = {
      icon: UploadCloud,
      text: t.sync.uploadWaiting(uploads),
      tone: 'text-muted',
      spin: false,
    }
  } else if (variant === 'bar') {
    content = { icon: RefreshCw, text: t.sync.upToDate, tone: 'text-muted', spin: false }
  }
  if (!content) return null

  const Icon = content.icon
  const glyph = (
    <Icon className={`size-5 ${content.spin ? 'animate-spin' : ''}`} aria-hidden="true" />
  )

  if (variant === 'bar') {
    const className = `flex min-h-11 items-center gap-2 px-3 text-xs ${content.tone}`
    const body = (
      <>
        {glyph}
        <span>{content.text}</span>
      </>
    )
    return content.to ? (
      <Link to={content.to} className={className}>
        {body}
      </Link>
    ) : (
      <div className={className} role="status">
        {body}
      </div>
    )
  }

  const className = `relative flex size-11 shrink-0 items-center justify-center rounded-lg ${content.tone}`
  const badge =
    content.count !== undefined ? (
      <span
        aria-hidden="true"
        className="absolute top-1 right-1 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white"
      >
        {content.count > 9 ? '9+' : content.count}
      </span>
    ) : null
  const progress =
    content.percent !== undefined ? (
      <span
        aria-hidden="true"
        className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] leading-3 font-semibold tabular-nums"
      >
        {content.percent}%
      </span>
    ) : null
  return content.to ? (
    <Link to={content.to} className={className} aria-label={content.text} title={content.text}>
      {glyph}
      {badge}
    </Link>
  ) : (
    <span role="status" aria-label={content.text} title={content.text} className={className}>
      {glyph}
      {progress}
    </span>
  )
}

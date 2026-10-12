import { X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { t } from '@/i18n/ro'
import type { Notice } from '@/sync/runtime'
import { NoticeStack } from './NoticeStack'
import { useSyncRuntime } from '@/sync/SyncContext'
import type { SyncNotice, WritableTable } from '@/sync/types'

const TOAST_MS = 7000

function noticeText(notice: SyncNotice): string {
  switch (notice.kind) {
    case 'access_lost':
      return t.sync.accessLost(notice.name)
    case 'moved_to_root':
      return notice.table === 'notes'
        ? t.sync.noteMovedToRoot(notice.name || t.notes.untitled)
        : t.sync.movedToRoot(notice.name)
    case 'failed':
      return t.sync.failed(notice.name || itemFallback(notice.table))
    case 'conflict':
      return t.notes.conflict
    case 'gone':
      return t.sync.gone(notice.name || itemFallback(notice.table))
    case 'message':
      return notice.text
  }
}

const itemFallback = (table: WritableTable): string =>
  table === 'notes' ? t.notes.untitled : t.tables[table]

function Toast({ item, onDismiss }: { item: Notice; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])
  return (
    <div className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
      <p className="flex-1">{noticeText(item.notice)}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-2 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink"
        aria-label={t.common.close}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/** Sync notices ("Nu mai ai acces la…", "mutat în rădăcină") in the shared notice stack. */
export function Toaster() {
  const runtime = useSyncRuntime()
  const notices = useSyncExternalStore(
    runtime.notices.subscribe,
    runtime.notices.get,
    runtime.notices.get,
  )
  if (notices.length === 0) return null
  return (
    <NoticeStack>
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {notices.slice(-3).map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => runtime.dismissNotice(item.id)} />
        ))}
      </div>
    </NoticeStack>
  )
}

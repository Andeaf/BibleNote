import { useLiveQuery } from 'dexie-react-hooks'
import {
  File as FileIcon,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Music,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { restoreFile } from '@/data/files'
import { restoreFolder } from '@/data/folders'
import { restoreNote } from '@/data/notes'
import { restoreSpace } from '@/data/spaces'
import { collectTrash, daysLeft, type TrashItem } from '@/data/trash'
import { useNow } from '@/features/notes/hooks'
import { t } from '@/i18n/ro'
import { formatRelative } from '@/lib/time'
import { useSyncRuntime } from '@/sync/SyncContext'
import { ApiError } from '@/sync/types'

const ICONS: Record<TrashItem['kind'], LucideIcon> = {
  space: FolderOpen,
  folder: Folder,
  note: FileText,
  file: FileIcon,
}

function itemIcon(item: TrashItem): LucideIcon {
  if (item.kind !== 'file') return ICONS[item.kind]
  return item.fileKind === 'audio' ? Music : item.fileKind === 'image' ? ImageIcon : FileIcon
}

const nameOf = (item: TrashItem) => item.name.trim() || t.notes.untitled

/** Restoring a main folder is the owner's; anything inside, editors and up. */
const canRestore = (item: TrashItem) =>
  item.kind === 'space' ? item.role === 'owner' : item.role === 'owner' || item.role === 'editor'

/**
 * "Coș de gunoi" (docs/PLAN.md §5.8): what is in the trash in the spaces this user can see, with
 * "Restaurează" (works offline, through the outbox) and, for the owner, "Șterge definitiv" and
 * "Golește coșul" (online only: the server purges, then the files' objects are removed). The
 * automatic 30-day emptying is not done here: the server chooses it (sync/housekeeping.ts).
 */
export function TrashPage() {
  const { db, engine, userId, notify } = useSyncRuntime()
  const now = useNow()
  const [confirm, setConfirm] = useState<TrashItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const items = useLiveQuery(
    async () =>
      collectTrash({
        spaces: await db.spaces.toArray(),
        folders: await db.folders.toArray(),
        notes: await db.notes.filter((n) => !!n.deleted_at).toArray(),
        files: await db.files.filter((f) => !!f.deleted_at).toArray(),
        roles: new Map((await db.spaceAccess.toArray()).map((a) => [a.space_id, a.role])),
      }),
    [db],
  )
  const owned = (items ?? []).filter((item) => item.role === 'owner')

  async function restore(item: TrashItem) {
    if (item.kind === 'space') await restoreSpace(db, item.id)
    else if (item.kind === 'folder') await restoreFolder(db, userId, item.id)
    else if (item.kind === 'note') await restoreNote(db, item.id)
    else await restoreFile(db, item.id)
    engine.requestPush()
    notify({ kind: 'message', text: t.trash.restored(nameOf(item)) })
  }

  async function purge(list: TrashItem[]) {
    setBusy(true)
    try {
      if (!navigator.onLine) throw new ApiError('network', 'offline')
      const result = await engine.purge(list.map((item) => item.id))
      if (result.purged > 0) notify({ kind: 'message', text: t.trash.purged(result.purged) })
      if (result.skipped.length > 0) notify({ kind: 'message', text: t.trash.notPurged })
    } catch (error) {
      const offline = error instanceof ApiError && error.kind === 'network'
      notify({ kind: 'message', text: offline ? t.common.needsInternet : t.trash.failed })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const single = confirm?.length === 1 ? confirm[0] : null

  return (
    <>
      <PageHeader
        title={t.trash.title}
        actions={
          owned.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary size-11 px-0 text-danger sm:size-auto sm:px-4"
              aria-label={t.trash.emptyTrash}
              disabled={busy}
              onClick={() => setConfirm(owned)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t.trash.emptyTrash}</span>
            </button>
          )
        }
      />
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6">
        <p className="mb-4 text-sm text-muted">{t.trash.intro}</p>
        {items === undefined ? null : items.length === 0 ? (
          <EmptyState icon={Trash2} title={t.trash.title} hint={t.trash.empty} />
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {items.map((item) => {
              const Icon = itemIcon(item)
              const name = nameOf(item)
              const when = formatRelative(item.deletedAt, now) ?? t.notes.justNow
              return (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-center gap-3 rounded-xl border border-line bg-surface py-2 pr-1 pl-3"
                >
                  <Icon className="size-5 shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{name}</p>
                    <p className="truncate text-xs text-muted">
                      {[t.trash.kinds[item.kind], ...item.path.filter(Boolean)].join(' › ')}
                    </p>
                    <p className="text-xs text-muted">
                      {t.trash.deletedAgo(when)} ·{' '}
                      {t.trash.daysLeft(daysLeft(item.expiresFrom, now))}
                    </p>
                  </div>
                  {canRestore(item) && (
                    <button
                      type="button"
                      className="btn btn-secondary size-11 shrink-0 px-0 sm:size-auto sm:px-3"
                      aria-label={t.trash.restoreItem(name)}
                      onClick={() => void restore(item)}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      <span className="hidden sm:inline">{t.trash.restore}</span>
                    </button>
                  )}
                  {item.role === 'owner' && (
                    <button
                      type="button"
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-danger hover:bg-canvas"
                      aria-label={t.trash.purgeItem(name)}
                      title={t.trash.purge}
                      disabled={busy}
                      onClick={() => setConfirm([item])}
                    >
                      <Trash2 className="size-5" aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={single ? t.trash.purgeTitle(nameOf(single)) : t.trash.emptyTitle}
        message={
          single
            ? single.kind === 'space'
              ? t.trash.purgeSpaceHint
              : t.trash.purgeHint
            : [
                t.trash.emptyHint(confirm?.length ?? 0),
                owned.length < (items?.length ?? 0) ? t.trash.emptyOwnHint : '',
              ]
                .filter(Boolean)
                .join(' ')
        }
        confirmLabel={single ? t.trash.purge : t.trash.emptyTrash}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => (confirm ? purge(confirm) : undefined)}
      />
    </>
  )
}

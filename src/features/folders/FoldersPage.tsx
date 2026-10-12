import { FolderPlus, Palette, Pencil, Plus, Share2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '@/auth/AuthContext'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu } from '@/components/ui/Menu'
import { createSpace, trashSpace, updateSpace } from '@/data/spaces'
import { sortItems } from '@/data/tree'
import { t } from '@/i18n/ro'
import { foldersScreen } from '@/auth/allowedAccess'
import { NoAccessState } from '@/features/auth/NoAccessState'
import { IosInstallBanner } from '@/features/install/Install'
import { PasteLinkField } from '@/features/share/PasteLinkField'
import { sharePath, trashPath } from '@/lib/paths'
import { useSyncRuntime, useSyncState } from '@/sync/SyncContext'
import { FolderDialog, type FolderFormValue } from './FolderDialog'
import { FolderIcon } from './FolderIcon'
import { useSortMode, useSpaces, type SpaceWithRole } from './hooks'
import { SortToggle } from './SortToggle'

type DialogState = null | { mode: 'create' } | { mode: 'edit'; space: SpaceWithRole }

/** The list of main folders: the user's own and the ones received through links. */
export function FoldersPage() {
  const { allowed } = useAuth()
  const { db, engine, userId } = useSyncRuntime()
  const navigate = useNavigate()
  const spaces = useSpaces()
  const { lastPullAt } = useSyncState()
  const screen = foldersScreen({
    allowed,
    spaceCount: spaces?.length ?? 0,
    pulled: lastPullAt !== null,
  })
  const [sort, setSort] = useSortMode()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [trashing, setTrashing] = useState<SpaceWithRole | null>(null)

  const mine = sortItems(spaces?.filter((s) => s.role === 'owner') ?? [], sort)
  const shared = sortItems(spaces?.filter((s) => s.role !== 'owner') ?? [], sort)

  async function submit(value: FolderFormValue) {
    if (dialog?.mode === 'edit') await updateSpace(db, dialog.space.id, value)
    else await createSpace(db, userId, value)
    engine.requestPush()
  }

  async function confirmTrash() {
    if (!trashing) return
    await trashSpace(db, trashing.id)
    engine.requestPush()
    setTrashing(null)
  }

  const card = (space: SpaceWithRole) => (
    <li key={space.id}>
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface pr-1 pl-3">
        <Link
          to={`/f/${space.id}`}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2"
        >
          <FolderIcon emoji={space.emoji} color={space.color} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{space.name}</span>
            {space.role === 'viewer' && (
              <span className="block text-xs text-muted">{t.folders.roleViewer}</span>
            )}
          </span>
        </Link>
        {space.role === 'owner' && (
          <Menu
            label={`${t.common.menu}: ${space.name}`}
            items={[
              {
                label: t.folders.rename,
                icon: Pencil,
                onSelect: () => setDialog({ mode: 'edit', space }),
              },
              {
                label: t.folders.appearance,
                icon: Palette,
                onSelect: () => setDialog({ mode: 'edit', space }),
              },
              {
                label: t.share.title,
                icon: Share2,
                onSelect: () => void navigate(sharePath(space.id)),
              },
              {
                label: t.folders.trash,
                icon: Trash2,
                destructive: true,
                onSelect: () => setTrashing(space),
              },
            ]}
          />
        )}
      </div>
    </li>
  )

  return (
    <>
      <PageHeader
        title={t.folders.title}
        actions={
          <>
            <SortToggle mode={sort} onChange={setSort} />
            {allowed && (
              <button
                type="button"
                className="btn btn-primary ml-1 size-11 px-0 sm:ml-2 sm:size-auto sm:px-4"
                aria-label={t.folders.newSpace}
                onClick={() => setDialog({ mode: 'create' })}
              >
                <Plus className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t.folders.newSpace}</span>
              </button>
            )}
          </>
        }
      />

      <div className="mx-auto max-w-4xl px-4 py-4 lg:px-6">
        <IosInstallBanner className="mb-4" />
        {spaces === undefined ? null : screen === 'no_access' ? (
          <NoAccessState />
        ) : screen !== 'list' ? (
          <EmptyState
            icon={FolderPlus}
            title={t.folders.title}
            hint={screen === 'empty_owner' ? t.folders.empty : t.folders.emptyShared}
          />
        ) : (
          <>
            {mine.length > 0 && (
              <section>
                {shared.length > 0 && (
                  <h2 className="mb-2 text-sm font-medium text-muted">{t.folders.mine}</h2>
                )}
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{mine.map(card)}</ul>
              </section>
            )}
            {shared.length > 0 && (
              <section className="mt-6">
                <h2 className="mb-2 text-sm font-medium text-muted">{t.folders.shared}</h2>
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{shared.map(card)}</ul>
              </section>
            )}
          </>
        )}
        {spaces !== undefined && (
          <>
            {/* On phones the trash has no place in the bottom bar: it lives here and in Settings. */}
            <Link
              to={trashPath}
              className="mx-auto mt-8 flex min-h-11 w-fit items-center gap-2 rounded-lg px-3 text-sm text-muted hover:text-ink lg:hidden"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t.trash.title}
            </Link>
            <PasteLinkField className="mx-auto mt-6 max-w-md border-t border-line pt-6" />
          </>
        )}
      </div>

      <FolderDialog
        open={dialog !== null}
        title={dialog?.mode === 'edit' ? t.folders.dialogEdit : t.folders.dialogCreateSpace}
        initial={
          dialog?.mode === 'edit'
            ? { name: dialog.space.name, color: dialog.space.color, emoji: dialog.space.emoji }
            : undefined
        }
        submitLabel={dialog?.mode === 'edit' ? t.common.save : t.common.create}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
      <ConfirmDialog
        open={trashing !== null}
        title={t.folders.trashTitle(trashing?.name ?? '')}
        message={t.folders.trashSpaceHint}
        confirmLabel={t.folders.trash}
        destructive
        onCancel={() => setTrashing(null)}
        onConfirm={confirmTrash}
      />
    </>
  )
}

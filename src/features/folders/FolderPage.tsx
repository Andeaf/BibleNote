import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Palette,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { createFolder, moveFolder, trashFolder, updateFolder } from '@/data/folders'
import { childrenOf, isSelfOrDescendant, pathTo, sortItems } from '@/data/tree'
import { t } from '@/i18n/ro'
import type { FolderRow } from '@/lib/database.types'
import { useSyncRuntime } from '@/sync/SyncContext'
import { FolderDialog, type FolderFormValue } from './FolderDialog'
import { FolderIcon } from './FolderIcon'
import { canEditRole, useIsDesktop, useSortMode, useSpace, useSpaceFolders } from './hooks'
import { MoveDialog } from './MoveDialog'
import { SortToggle } from './SortToggle'

type DialogState =
  | null
  | { mode: 'create' }
  | { mode: 'edit'; folder: FolderRow }
  | { mode: 'move'; folder: FolderRow }
  | { mode: 'trash'; folder: FolderRow }

const folderPath = (spaceId: string, folderId: string | null) =>
  folderId ? `/f/${spaceId}/${folderId}` : `/f/${spaceId}`

/** One folder of a main folder: breadcrumb, subfolders, create/rename/move/trash. */
export function FolderPage() {
  const { spaceId = '', folderId } = useParams()
  const navigate = useNavigate()
  const { db, engine, userId } = useSyncRuntime()
  const space = useSpace(spaceId)
  const folders = useSpaceFolders(spaceId)
  const isDesktop = useIsDesktop()
  const [sort, setSort] = useSortMode()
  const [dialog, setDialog] = useState<DialogState>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  if (space === undefined || folders === undefined) return null

  const current = folderId ? folders.find((f) => f.id === folderId) : null
  if (!space || (folderId && (!current || current.deleted_at))) {
    return (
      <div className="px-4 py-10">
        <EmptyState icon={FolderOpen} title={t.folders.title} hint={t.folders.notFound} />
        <p className="text-center">
          <Link to="/" className="btn btn-secondary">
            {t.folders.backToFolders}
          </Link>
        </p>
      </div>
    )
  }

  const canEdit = canEditRole(space.role)
  const path = pathTo(folders, folderId ?? null)
  const children = sortItems(childrenOf(folders, folderId ?? null), sort)
  const parentId = current?.parent_id ?? null
  const backTo = current ? folderPath(spaceId, parentId) : '/'

  async function submit(value: FolderFormValue) {
    if (dialog?.mode === 'edit') await updateFolder(db, userId, dialog.folder.id, value)
    else await createFolder(db, userId, spaceId, folderId ?? null, value)
    engine.requestPush()
  }

  async function move(id: string, targetParentId: string | null) {
    if (await moveFolder(db, userId, id, targetParentId)) engine.requestPush()
  }

  async function confirmTrash() {
    if (dialog?.mode !== 'trash') return
    const id = dialog.folder.id
    await trashFolder(db, userId, id)
    engine.requestPush()
    setDialog(null)
    if (id === folderId) void navigate(backTo, { replace: true })
  }

  function onDragEnd(event: DragEndEvent) {
    const over = event.over?.id
    if (typeof over !== 'string') return
    const id = String(event.active.id)
    const target = over === 'drop:root' ? null : over.replace(/^drop:/, '')
    if (target === id || isSelfOrDescendant(folders ?? [], id, target)) return
    void move(id, target)
  }

  const menuFor = (folder: FolderRow): MenuItem[] => [
    { label: t.folders.rename, icon: Pencil, onSelect: () => setDialog({ mode: 'edit', folder }) },
    {
      label: t.folders.appearance,
      icon: Palette,
      onSelect: () => setDialog({ mode: 'edit', folder }),
    },
    {
      label: t.folders.move,
      icon: FolderInput,
      onSelect: () => setDialog({ mode: 'move', folder }),
    },
    {
      label: t.folders.trash,
      icon: Trash2,
      destructive: true,
      onSelect: () => setDialog({ mode: 'trash', folder }),
    },
  ]

  const breadcrumb = (
    <nav
      aria-label={t.folders.breadcrumb}
      className="flex flex-wrap items-center gap-1 text-sm text-muted"
    >
      <Link to="/" className="rounded-md px-1 py-1 hover:text-ink">
        {t.folders.title}
      </Link>
      <ChevronRight className="size-4" aria-hidden="true" />
      <Crumb
        to={`/f/${spaceId}`}
        dropId="drop:root"
        active={!current}
        droppable={isDesktop && canEdit}
      >
        {space.name}
      </Crumb>
      {path.map((folder) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-4" aria-hidden="true" />
          <Crumb
            to={folderPath(spaceId, folder.id)}
            dropId={`drop:${folder.id}`}
            active={folder.id === folderId}
            droppable={isDesktop && canEdit && folder.id !== folderId}
          >
            {folder.name}
          </Crumb>
        </span>
      ))}
    </nav>
  )

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <PageHeader
        title={current?.name ?? space.name}
        backTo={backTo}
        above={breadcrumb}
        titleMenu={
          current && canEdit ? (
            <Menu label={`${t.common.menu}: ${current.name}`} items={menuFor(current)} />
          ) : undefined
        }
        actions={
          <>
            <SortToggle mode={sort} onChange={setSort} />
            {canEdit && (
              <button
                type="button"
                className="btn btn-primary ml-2"
                onClick={() => setDialog({ mode: 'create' })}
              >
                <Plus className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t.folders.newFolder}</span>
              </button>
            )}
          </>
        }
      />

      <div className="mx-auto max-w-4xl px-4 py-4 lg:px-6">
        {children.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title={current?.name ?? space.name}
            hint={t.folders.emptyFolder}
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {children.map((folder) => (
              <FolderRowItem
                key={folder.id}
                folder={folder}
                to={folderPath(spaceId, folder.id)}
                draggable={isDesktop && canEdit}
                menu={canEdit ? menuFor(folder) : undefined}
              />
            ))}
          </ul>
        )}
      </div>

      <FolderDialog
        open={dialog?.mode === 'create' || dialog?.mode === 'edit'}
        title={dialog?.mode === 'edit' ? t.folders.dialogEdit : t.folders.dialogCreateFolder}
        initial={
          dialog?.mode === 'edit'
            ? { name: dialog.folder.name, color: dialog.folder.color, emoji: dialog.folder.emoji }
            : undefined
        }
        submitLabel={dialog?.mode === 'edit' ? t.common.save : t.common.create}
        onClose={() => setDialog(null)}
        onSubmit={submit}
      />
      {dialog?.mode === 'move' && (
        <MoveDialog
          open
          folders={folders}
          spaceName={space.name}
          movingId={dialog.folder.id}
          currentParentId={dialog.folder.parent_id}
          onClose={() => setDialog(null)}
          onMove={(target) => move(dialog.folder.id, target)}
        />
      )}
      <ConfirmDialog
        open={dialog?.mode === 'trash'}
        title={t.folders.trashTitle(dialog?.mode === 'trash' ? dialog.folder.name : '')}
        message={t.folders.trashFolderHint}
        confirmLabel={t.folders.trash}
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={confirmTrash}
      />
    </DndContext>
  )
}

interface CrumbProps {
  to: string
  dropId: string
  active: boolean
  droppable: boolean
  children: string
}

function Crumb({ to, dropId, active, droppable, children }: CrumbProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled: !droppable })
  return (
    <Link
      ref={setNodeRef}
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`rounded-md px-1 py-1 ${active ? 'font-medium text-ink' : 'hover:text-ink'} ${
        isOver ? 'bg-accent-soft text-accent' : ''
      }`}
    >
      {children}
    </Link>
  )
}

interface FolderRowItemProps {
  folder: FolderRow
  to: string
  draggable: boolean
  menu?: MenuItem[]
}

/** A subfolder row: a link, a menu and, on desktop, a drag source and drop target. */
function FolderRowItem({ folder, to, draggable, menu }: FolderRowItemProps) {
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: folder.id,
    disabled: !draggable,
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${folder.id}`,
    disabled: !draggable,
  })
  return (
    <li
      ref={setDropRef}
      className={`flex items-center gap-2 rounded-xl border bg-surface pr-1 pl-2 ${
        isOver ? 'border-accent bg-accent-soft' : 'border-line'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <Link
        ref={setDragRef}
        {...listeners}
        {...attributes}
        to={to}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 touch-manipulation"
      >
        <FolderIcon emoji={folder.emoji} color={folder.color} />
        <span className="truncate font-medium">{folder.name}</span>
      </Link>
      {menu && <Menu label={`${t.common.menu}: ${folder.name}`} items={menu} />}
    </li>
  )
}

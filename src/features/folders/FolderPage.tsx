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
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderInput,
  Mic,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { moveFile } from '@/data/files'
import { createFolder, moveFolder, trashFolder, updateFolder } from '@/data/folders'
import { createNote, moveNote, setNotePinned, trashNote } from '@/data/notes'
import {
  childrenOf,
  descendantIds,
  isSelfOrDescendant,
  pathTo,
  sortItems,
  sortNotes,
} from '@/data/tree'
import { FILE_DRAG, FolderFiles } from '@/features/files/FolderFiles'
import { useSpaceFiles } from '@/features/files/hooks'
import { useUpload } from '@/features/files/useUpload'
import { useNow, useSpaceNotes } from '@/features/notes/hooks'
import { NoteRowItem } from '@/features/notes/NoteRowItem'
import { RecorderDialog } from '@/features/recorder/RecorderDialog'
import { TagChip } from '@/features/tags/TagChip'
import { t } from '@/i18n/ro'
import type { FileKind, FolderRow, NoteRow } from '@/lib/database.types'
import { folderPath, notePath, sharePath } from '@/lib/paths'
import { collectTags, tagKey } from '@/lib/tags'
import { useSyncRuntime, useSyncState } from '@/sync/SyncContext'
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
  | { mode: 'move-note'; note: NoteRow }
  | { mode: 'trash-note'; note: NoteRow }
  | { mode: 'record' }

const NOTE_DRAG = 'note:'
const noteTitle = (note: NoteRow) => note.title.trim() || t.notes.untitled

/** The type filter (?type=): Notițe / Audio / Imagini / Documente. */
type TypeFilter = 'all' | 'notes' | FileKind
const TYPE_FILTERS: TypeFilter[] = ['all', 'notes', 'audio', 'image', 'document']
const toTypeFilter = (value: string | null): TypeFilter =>
  TYPE_FILTERS.find((type) => type === value) ?? 'all'

/**
 * One folder of a main folder: breadcrumb, subfolders, notes (pinned first) and files (images as
 * a gallery), a tag filter over the whole subtree and a type filter, create/rename/move/trash,
 * upload (button, or files dropped on the page on desktop), audio recording, drag & drop.
 */
export function FolderPage() {
  const { spaceId = '', folderId } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { db, engine, userId } = useSyncRuntime()
  const { pulling, lastPullAt, online } = useSyncState()
  const space = useSpace(spaceId)
  const folders = useSpaceFolders(spaceId)
  const notes = useSpaceNotes(spaceId)
  const files = useSpaceFiles(spaceId)
  const isDesktop = useIsDesktop()
  const now = useNow()
  const [sort, setSort] = useSortMode()
  const [dialog, setDialog] = useState<DialogState>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const tagFilter = params.get('tag')
  const typeFilter = toTypeFilter(params.get('type'))
  const here = folderId ?? null
  const { upload, busy: preparing } = useUpload(spaceId, here)
  const fileInput = useRef<HTMLInputElement>(null)
  const [dropping, setDropping] = useState(false)

  const subtreeNotes = useMemo(() => {
    if (!folders || !notes) return []
    const ids = new Set<string | null>([here, ...(here ? descendantIds(folders, here) : [])])
    const liveFolders = new Set(folders.filter((f) => !f.deleted_at).map((f) => f.id))
    return notes.filter(
      (n) =>
        !n.deleted_at &&
        (here === null
          ? n.folder_id === null || liveFolders.has(n.folder_id)
          : ids.has(n.folder_id)),
    )
  }, [folders, notes, here])
  const folderTags = useMemo(() => collectTags(subtreeNotes), [subtreeNotes])

  if (space === undefined || folders === undefined || notes === undefined || files === undefined) {
    return null
  }

  const current = folderId ? folders.find((f) => f.id === folderId) : null
  // Just entered through a link: the space arrives with the first pull.
  if (!space && (pulling || (lastPullAt === null && online))) {
    return (
      <p role="status" className="px-4 py-10 text-center text-muted">
        {t.common.loading}
      </p>
    )
  }
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
  const path = pathTo(folders, here)
  const children = sortItems(childrenOf(folders, here), sort)
  const parentId = current?.parent_id ?? null
  const backTo = current ? folderPath(spaceId, parentId) : '/'
  const activeTag = tagFilter ? folderTags.find((use) => use.key === tagKey(tagFilter)) : undefined
  const listed = activeTag
    ? sortNotes(
        subtreeNotes.filter((n) => n.tags.some((tag) => tagKey(tag) === activeTag.key)),
        sort,
      )
    : sortNotes(
        subtreeNotes.filter((n) => n.folder_id === here),
        sort,
      )
  const hereFiles = sortItems(
    files.filter((f) => f.folder_id === here && !f.deleted_at),
    sort,
  )
  const shownFiles = activeTag
    ? []
    : typeFilter === 'all'
      ? hereFiles
      : hereFiles.filter((f) => f.kind === typeFilter)
  const showNotes = typeFilter === 'all' || typeFilter === 'notes'
  const shownNotes = showNotes ? listed : []
  const folderName = (id: string | null) =>
    [space.name, ...pathTo(folders, id).map((f) => f.name)].join(' › ')

  function setParam(name: 'tag' | 'type', value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    setParams(next, { replace: true })
  }
  const setTag = (key: string | null) => setParam('tag', key)

  // Files dragged from the computer onto the page (desktop); dnd-kit moves are not "Files".
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const dropProps = canEdit
    ? {
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropping(true)
        },
        onDragLeave: (event: DragEvent) => {
          if (event.currentTarget === event.target) setDropping(false)
        },
        onDrop: (event: DragEvent) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDropping(false)
          void upload(event.dataTransfer.files)
        },
      }
    : {}

  async function submit(value: FolderFormValue) {
    if (dialog?.mode === 'edit') await updateFolder(db, userId, dialog.folder.id, value)
    else await createFolder(db, userId, spaceId, here, value)
    engine.requestPush()
  }

  async function newNote() {
    const note = await createNote(db, userId, spaceId, here)
    void navigate(notePath(note.id))
  }

  async function move(id: string, targetParentId: string | null) {
    if (await moveFolder(db, userId, id, targetParentId)) engine.requestPush()
  }

  async function moveNoteTo(id: string, target: string | null) {
    if (await moveNote(db, id, target)) engine.requestPush()
  }

  async function confirmTrash() {
    if (dialog?.mode === 'trash-note') {
      await trashNote(db, dialog.note.id)
      engine.requestPush()
      setDialog(null)
      return
    }
    if (dialog?.mode !== 'trash') return
    const id = dialog.folder.id
    await trashFolder(db, userId, id)
    engine.requestPush()
    setDialog(null)
    if (id === folderId) void navigate(backTo, { replace: true })
  }

  async function togglePin(note: NoteRow) {
    await setNotePinned(db, note.id, !note.pinned)
    engine.requestPush()
  }

  function onDragEnd(event: DragEndEvent) {
    const over = event.over?.id
    if (typeof over !== 'string') return
    const id = String(event.active.id)
    const target = over === 'drop:root' ? null : over.replace(/^drop:/, '')
    if (id.startsWith(NOTE_DRAG)) {
      void moveNoteTo(id.slice(NOTE_DRAG.length), target)
      return
    }
    if (id.startsWith(FILE_DRAG)) {
      void moveFile(db, id.slice(FILE_DRAG.length), target).then((moved) => {
        if (moved) engine.requestPush()
      })
      return
    }
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

  const noteMenu = (note: NoteRow): MenuItem[] => [
    {
      label: note.pinned ? t.notes.unpin : t.notes.pin,
      icon: note.pinned ? PinOff : Pin,
      onSelect: () => void togglePin(note),
    },
    {
      label: t.notes.move,
      icon: FolderInput,
      onSelect: () => setDialog({ mode: 'move-note', note }),
    },
    {
      label: t.notes.trash,
      icon: Trash2,
      destructive: true,
      onSelect: () => setDialog({ mode: 'trash-note', note }),
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

  const showFolders = !activeTag && typeFilter === 'all' && children.length > 0
  const empty = !showFolders && shownNotes.length === 0 && shownFiles.length === 0

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
            {!current && space.role === 'owner' && (
              <Link
                to={sharePath(spaceId)}
                className="btn btn-secondary ml-2 hidden size-11 px-0 sm:inline-flex"
                aria-label={t.share.title}
                title={t.share.title}
              >
                <Share2 className="size-4" aria-hidden="true" />
              </Link>
            )}
            {canEdit && (
              <>
                <div className="ml-1 sm:hidden">
                  <Menu
                    icon={Plus}
                    label={t.folders.add}
                    triggerClassName="btn btn-primary size-11 px-0"
                    items={[
                      { label: t.notes.newNote, icon: FilePlus, onSelect: () => void newNote() },
                      {
                        label: t.folders.newFolder,
                        icon: FolderPlus,
                        onSelect: () => setDialog({ mode: 'create' }),
                      },
                      {
                        label: t.files.upload,
                        icon: Upload,
                        onSelect: () => fileInput.current?.click(),
                      },
                      {
                        label: t.recorder.title,
                        icon: Mic,
                        onSelect: () => setDialog({ mode: 'record' }),
                      },
                      ...(!current && space.role === 'owner'
                        ? [
                            {
                              label: t.share.title,
                              icon: Share2,
                              onSelect: () => void navigate(sharePath(spaceId)),
                            },
                          ]
                        : []),
                    ]}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary ml-2 hidden sm:inline-flex"
                  onClick={() => setDialog({ mode: 'create' })}
                  aria-label={t.folders.newFolder}
                >
                  <FolderPlus className="size-4" aria-hidden="true" />
                  <span className="hidden xl:inline">{t.folders.newFolder}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary ml-2 hidden sm:inline-flex"
                  onClick={() => fileInput.current?.click()}
                  aria-label={t.files.upload}
                >
                  <Upload className="size-4" aria-hidden="true" />
                  <span className="hidden xl:inline">{t.files.uploadShort}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary ml-2 hidden sm:inline-flex"
                  onClick={() => setDialog({ mode: 'record' })}
                  aria-label={t.recorder.title}
                >
                  <Mic className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn btn-primary ml-2 hidden sm:inline-flex"
                  onClick={() => void newNote()}
                >
                  <FilePlus className="size-4" aria-hidden="true" />
                  {t.notes.newNote}
                </button>
              </>
            )}
          </>
        }
      />

      <div
        className={`relative mx-auto max-w-4xl px-4 py-4 lg:px-6 ${
          dropping ? 'rounded-2xl outline-2 outline-accent outline-dashed' : ''
        }`}
        {...dropProps}
      >
        {canEdit && (
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              void upload(event.target.files)
              event.target.value = ''
            }}
          />
        )}
        {dropping && (
          <p className="pointer-events-none absolute inset-x-4 top-2 z-10 rounded-xl bg-accent-soft px-4 py-3 text-center text-sm font-medium text-accent">
            {t.files.dropHere}
          </p>
        )}
        {preparing && (
          <p role="status" className="mb-3 text-sm text-muted">
            {t.files.preparing}
          </p>
        )}
        {hereFiles.length > 0 && !activeTag && (
          <div
            role="group"
            aria-label={t.files.filter}
            className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1"
          >
            {TYPE_FILTERS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setParam('type', type === 'all' ? null : type)}
                aria-pressed={typeFilter === type}
                className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium ${
                  typeFilter === type
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-line text-muted'
                }`}
              >
                {t.files.types[type]}
              </button>
            ))}
          </div>
        )}
        {folderTags.length > 0 && showNotes && (
          <div
            role="group"
            aria-label={t.tags.filter}
            className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1"
          >
            <button
              type="button"
              onClick={() => setTag(null)}
              aria-pressed={!activeTag}
              className={`min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium ${
                activeTag ? 'border-line text-muted' : 'border-accent bg-accent-soft text-accent'
              }`}
            >
              {t.tags.all}
            </button>
            {folderTags.map((use) => (
              <span key={use.key} className="shrink-0">
                <TagChip
                  tag={use.tag}
                  selected={activeTag?.key === use.key}
                  onClick={() => setTag(activeTag?.key === use.key ? null : use.key)}
                />
              </span>
            ))}
          </div>
        )}

        {empty ? (
          <EmptyState
            icon={FolderPlus}
            title={current?.name ?? space.name}
            hint={
              activeTag
                ? t.tags.noNotes
                : typeFilter !== 'all'
                  ? t.files.emptyType
                  : t.folders.emptyFolder
            }
          />
        ) : (
          <>
            {showFolders && (
              <section aria-label={t.folders.subfolders}>
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
              </section>
            )}
            {shownNotes.length > 0 && (
              <section aria-label={t.notes.list} className={showFolders ? 'mt-4' : ''}>
                <ul className="flex flex-col gap-1">
                  {shownNotes.map((note) => (
                    <li key={note.id}>
                      <DraggableNote
                        note={note}
                        now={now}
                        draggable={isDesktop && canEdit}
                        location={activeTag ? folderName(note.folder_id) : undefined}
                        menu={canEdit ? noteMenu(note) : undefined}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {shownFiles.length > 0 && (
              <FolderFiles
                files={shownFiles}
                folders={folders}
                spaceName={space.name}
                canEdit={canEdit}
                draggable={isDesktop && canEdit}
                now={now}
                className={showFolders || shownNotes.length > 0 ? 'mt-4' : ''}
              />
            )}
          </>
        )}
      </div>
      {dialog?.mode === 'record' && (
        <RecorderDialog spaceId={spaceId} folderId={here} onClose={() => setDialog(null)} />
      )}

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
      {dialog?.mode === 'move-note' && (
        <MoveDialog
          open
          title={t.notes.moveTitle}
          folders={folders}
          spaceName={space.name}
          currentParentId={dialog.note.folder_id}
          onClose={() => setDialog(null)}
          onMove={(target) => moveNoteTo(dialog.note.id, target)}
        />
      )}
      <ConfirmDialog
        open={dialog?.mode === 'trash' || dialog?.mode === 'trash-note'}
        title={
          dialog?.mode === 'trash'
            ? t.folders.trashTitle(dialog.folder.name)
            : dialog?.mode === 'trash-note'
              ? t.notes.trashTitle(noteTitle(dialog.note))
              : ''
        }
        message={dialog?.mode === 'trash-note' ? t.notes.trashHint : t.folders.trashFolderHint}
        confirmLabel={dialog?.mode === 'trash-note' ? t.notes.trash : t.folders.trash}
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

interface DraggableNoteProps {
  note: NoteRow
  now: number
  draggable: boolean
  location?: string
  menu?: MenuItem[]
}

/** A note row that can be dragged onto a folder or a breadcrumb item on desktop. */
function DraggableNote({ note, now, draggable, location, menu }: DraggableNoteProps) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${NOTE_DRAG}${note.id}`,
    disabled: !draggable,
  })
  return (
    <NoteRowItem
      note={note}
      now={now}
      location={location}
      menu={menu}
      dragRef={setNodeRef}
      dragProps={{ ...listeners, ...attributes }}
      className={isDragging ? 'opacity-50' : ''}
    />
  )
}

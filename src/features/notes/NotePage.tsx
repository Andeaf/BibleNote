import { ChevronRight, FileText, FolderInput, Pin, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu } from '@/components/ui/Menu'
import { moveNote, setNotePinned, trashNote } from '@/data/notes'
import { pathTo, sortNotes } from '@/data/tree'
import { canEditRole, useSortMode, useSpace, useSpaceFolders } from '@/features/folders/hooks'
import { MoveDialog } from '@/features/folders/MoveDialog'
import { t } from '@/i18n/ro'
import { folderPath, notePath } from '@/lib/paths'
import { collectTags } from '@/lib/tags'
import { useSyncRuntime } from '@/sync/SyncContext'
import { NoteEditor } from './editor/NoteEditor'
import { useAllNotes, useMyName, useNote } from './hooks'
import { NoteStatus } from './NoteStatus'

/**
 * One note: header with the save state, pin and menu; the editor; on wide screens the other
 * notes of the folder beside it (tree, list, editor). Loaded on demand with the editor code.
 */
export default function NotePage() {
  const { noteId = '' } = useParams()
  const navigate = useNavigate()
  const runtime = useSyncRuntime()
  const { db, engine, userId } = runtime
  const note = useNote(noteId)
  const spaceId = note?.space_id ?? ''
  const space = useSpace(spaceId)
  const myName = useMyName(spaceId)
  const presence = useSyncExternalStore(runtime.presence.subscribe, runtime.presence.get)
  const editing = canEditRole(space?.role) && !!note && !note.deleted_at

  // "X editează acum": the others in this space see that this note is open for editing here.
  useEffect(() => {
    if (!editing || !spaceId) return
    runtime.setEditing(spaceId, { name: myName, noteId })
    return () => runtime.setEditing(spaceId, null)
  }, [runtime, editing, spaceId, noteId, myName])
  const othersEditing = [
    ...new Set(
      (presence[spaceId] ?? [])
        .filter((entry) => entry.note_id === noteId && entry.user_id !== userId)
        .map((entry) => entry.name.trim() || t.notes.someone),
    ),
  ]
  const folders = useSpaceFolders(spaceId)
  const allNotes = useAllNotes()
  const [sort] = useSortMode()
  const [dirty, setDirty] = useState(false)
  const [dialog, setDialog] = useState<null | 'move' | 'trash'>(null)

  const knownTags = useMemo(() => collectTags(allNotes ?? []).map((use) => use.tag), [allNotes])
  const siblings = useMemo(
    () =>
      sortNotes(
        (allNotes ?? []).filter((n) => n.space_id === spaceId && n.folder_id === note?.folder_id),
        sort,
      ),
    [allNotes, spaceId, note?.folder_id, sort],
  )

  if (note === undefined || (note && (space === undefined || folders === undefined))) return null
  if (!note || note.deleted_at || !space) {
    return (
      <div className="px-4 py-10">
        <EmptyState icon={FileText} title={t.notes.note} hint={t.notes.notFound} />
        <p className="text-center">
          <Link to="/" className="btn btn-secondary">
            {t.folders.backToFolders}
          </Link>
        </p>
      </div>
    )
  }

  const canEdit = canEditRole(space.role)
  const path = pathTo(folders ?? [], note.folder_id)
  const backTo = folderPath(space.id, note.folder_id)
  const title = note.title.trim() || t.notes.untitled

  async function togglePin() {
    if (!note) return
    await setNotePinned(db, note.id, !note.pinned)
    engine.requestPush()
  }

  async function move(target: string | null) {
    if (note && (await moveNote(db, note.id, target))) engine.requestPush()
  }

  async function confirmTrash() {
    if (!note) return
    await trashNote(db, note.id)
    engine.requestPush()
    setDialog(null)
    void navigate(backTo, { replace: true })
  }

  const breadcrumb = (
    <nav
      aria-label={t.folders.breadcrumb}
      className="flex flex-wrap items-center gap-1 text-sm text-muted"
    >
      <Link to="/" className="rounded-md px-1 py-1 hover:text-ink">
        {t.folders.title}
      </Link>
      <ChevronRight className="size-4" aria-hidden="true" />
      <Link to={folderPath(space.id, null)} className="rounded-md px-1 py-1 hover:text-ink">
        {space.name}
      </Link>
      {path.map((folder) => (
        <span key={folder.id} className="flex items-center gap-1">
          <ChevronRight className="size-4" aria-hidden="true" />
          <Link
            to={folderPath(space.id, folder.id)}
            className="rounded-md px-1 py-1 hover:text-ink"
          >
            {folder.name}
          </Link>
        </span>
      ))}
    </nav>
  )

  return (
    <>
      <PageHeader
        title={path.at(-1)?.name ?? space.name}
        backTo={backTo}
        above={breadcrumb}
        status={<NoteStatus noteId={note.id} dirty={dirty} readOnly={!canEdit} />}
        actions={
          canEdit && (
            <>
              <button
                type="button"
                onClick={() => void togglePin()}
                aria-pressed={note.pinned}
                aria-label={t.notes.pin}
                title={note.pinned ? t.notes.unpin : t.notes.pin}
                className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${
                  note.pinned ? 'text-accent' : 'text-muted hover:text-ink'
                }`}
              >
                <Pin className={`size-5 ${note.pinned ? 'fill-current' : ''}`} aria-hidden="true" />
              </button>
              <Menu
                label={`${t.common.menu}: ${title}`}
                items={[
                  { label: t.notes.move, icon: FolderInput, onSelect: () => setDialog('move') },
                  {
                    label: t.notes.trash,
                    icon: Trash2,
                    destructive: true,
                    onSelect: () => setDialog('trash'),
                  },
                ]}
              />
            </>
          )
        }
      />

      <div className="mx-auto flex max-w-6xl gap-6 px-4 lg:px-6">
        {siblings.length > 1 && (
          <nav aria-label={t.notes.inFolder} className="hidden w-64 shrink-0 pt-4 xl:block">
            <ul className="sticky top-4 flex max-h-[calc(100dvh-8rem)] flex-col gap-0.5 overflow-y-auto">
              {siblings.map((sibling) => (
                <li key={sibling.id}>
                  <NavLink
                    to={notePath(sibling.id)}
                    replace
                    className={({ isActive }) =>
                      `flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm ${
                        isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface'
                      }`
                    }
                  >
                    {sibling.pinned && <Pin className="size-3.5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{sibling.title.trim() || t.notes.untitled}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div className="mx-auto w-full max-w-3xl min-w-0">
          {othersEditing.length > 0 && (
            <p
              role="status"
              className="mt-4 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent"
            >
              <Users className="size-4 shrink-0" aria-hidden="true" />
              {t.share.editingNow(othersEditing.join(', '))}
            </p>
          )}
          <NoteEditor
            key={note.id}
            note={note}
            readOnly={!canEdit}
            knownTags={knownTags}
            onSwitch={(id) => void navigate(notePath(id), { replace: true })}
            onDirtyChange={setDirty}
          />
        </div>
      </div>

      {dialog === 'move' && (
        <MoveDialog
          open
          title={t.notes.moveTitle}
          folders={folders ?? []}
          spaceName={space.name}
          currentParentId={note.folder_id}
          onClose={() => setDialog(null)}
          onMove={move}
        />
      )}
      <ConfirmDialog
        open={dialog === 'trash'}
        title={t.notes.trashTitle(title)}
        message={t.notes.trashHint}
        confirmLabel={t.notes.trash}
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={confirmTrash}
      />
    </>
  )
}

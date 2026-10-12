import { Download, FolderInput, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { moveFile, renameFile, trashFile } from '@/data/files'
import { MoveDialog } from '@/features/folders/MoveDialog'
import { t } from '@/i18n/ro'
import type { FileRow, FolderRow } from '@/lib/database.types'
import { useSyncRuntime } from '@/sync/SyncContext'
import { RenameDialog } from './RenameDialog'
import { useDownload } from './useDownload'

type DialogState = null | 'rename' | 'move' | 'trash'

interface FileMenuProps {
  file: FileRow
  folders: FolderRow[]
  spaceName: string
  canEdit: boolean
  /** Replaces the trigger's look (the image viewer's dark bar). */
  triggerClassName?: string
  onTrashed?: () => void
}

/** "⋯" for a file: download for everyone; rename, move and trash for editors. */
export function FileMenu({
  file,
  folders,
  spaceName,
  canEdit,
  triggerClassName,
  onTrashed,
}: FileMenuProps) {
  const { db, engine } = useSyncRuntime()
  const download = useDownload()
  const [dialog, setDialog] = useState<DialogState>(null)

  const items: MenuItem[] = [
    { label: t.files.download, icon: Download, onSelect: () => void download(file) },
  ]
  if (canEdit) {
    items.push(
      { label: t.files.rename, icon: Pencil, onSelect: () => setDialog('rename') },
      { label: t.files.move, icon: FolderInput, onSelect: () => setDialog('move') },
      {
        label: t.files.trash,
        icon: Trash2,
        destructive: true,
        onSelect: () => setDialog('trash'),
      },
    )
  }

  return (
    <>
      <Menu
        label={`${t.common.menu}: ${file.name}`}
        items={items}
        triggerClassName={triggerClassName}
      />
      {dialog === 'rename' && (
        <RenameDialog
          open
          title={t.files.renameTitle}
          initial={file.name}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (await renameFile(db, file.id, name)) engine.requestPush()
          }}
        />
      )}
      {dialog === 'move' && (
        <MoveDialog
          open
          title={t.files.moveTitle}
          folders={folders}
          spaceName={spaceName}
          currentParentId={file.folder_id}
          onClose={() => setDialog(null)}
          onMove={async (target) => {
            if (await moveFile(db, file.id, target)) engine.requestPush()
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'trash'}
        title={t.files.trashTitle(file.name)}
        message={t.files.trashHint}
        confirmLabel={t.files.trash}
        destructive
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          await trashFile(db, file.id)
          engine.requestPush()
          setDialog(null)
          onTrashed?.()
        }}
      />
    </>
  )
}

import { useMemo, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { childrenOf, descendantIds } from '@/data/tree'
import { t } from '@/i18n/ro'
import type { FolderRow } from '@/lib/database.types'
import { FolderIcon } from './FolderIcon'

interface MoveDialogProps {
  open: boolean
  folders: FolderRow[]
  spaceName: string
  movingId: string
  currentParentId: string | null
  onClose: () => void
  onMove: (targetParentId: string | null) => Promise<void> | void
}

interface TreeLine {
  folder: FolderRow
  depth: number
}

/** "Mută în…": a radio list of the space's folders, without the moved folder's own subtree. */
export function MoveDialog({
  open,
  folders,
  spaceName,
  movingId,
  currentParentId,
  onClose,
  onMove,
}: MoveDialogProps) {
  const [target, setTarget] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const lines = useMemo(() => {
    const excluded = new Set([movingId, ...descendantIds(folders, movingId)])
    const out: TreeLine[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childrenOf(folders, parentId).sort((a, b) =>
        a.name.localeCompare(b.name, 'ro'),
      )) {
        if (excluded.has(folder.id)) continue
        out.push({ folder, depth })
        walk(folder.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [folders, movingId])

  const chosen = target === undefined ? currentParentId : target

  async function confirm() {
    if (chosen === currentParentId) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await onMove(chosen)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const option = (id: string | null, label: string, depth: number, icon?: FolderRow) => (
    <label
      key={id ?? 'root'}
      className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 ${
        chosen === id ? 'bg-accent-soft' : 'hover:bg-canvas'
      }`}
      style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
    >
      <input
        type="radio"
        name="target"
        checked={chosen === id}
        onChange={() => setTarget(id)}
        className="accent-accent"
      />
      {icon ? (
        <FolderIcon emoji={icon.emoji} color={icon.color} size="sm" />
      ) : (
        <span className="flex size-7 items-center justify-center text-base" aria-hidden="true">
          🏠
        </span>
      )}
      <span className="truncate text-sm">{label}</span>
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={t.folders.moveTitle}>
      <div className="max-h-[50dvh] overflow-y-auto">
        {option(null, `${t.folders.moveRoot} (${spaceName})`, 0)}
        {lines.map(({ folder, depth }) => option(folder.id, folder.name, depth + 1, folder))}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          {t.common.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void confirm()}
          disabled={busy}
        >
          {t.folders.moveConfirm}
        </button>
      </div>
    </Dialog>
  )
}

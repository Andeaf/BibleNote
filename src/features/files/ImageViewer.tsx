import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router'
import { t } from '@/i18n/ro'
import type { FileRow, FolderRow } from '@/lib/database.types'
import { filePath } from '@/lib/paths'
import { FileMenu } from './FileMenu'
import { useFileBlob } from './hooks'

interface ImageViewerProps {
  file: FileRow
  /** The images of the same folder, in gallery order. */
  siblings: FileRow[]
  backTo: string
  folders: FolderRow[]
  spaceName: string
  canEdit: boolean
}

const SWIPE_PX = 50
const darkButton =
  'flex size-11 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white'

/**
 * An image on the whole screen: swipe (phone), arrows or keys (desktop) to the previous or next
 * image of the folder. Moving between images replaces the history entry, so "Înapoi" returns
 * to the folder.
 */
export function ImageViewer({
  file,
  siblings,
  backTo,
  folders,
  spaceName,
  canEdit,
}: ImageViewerProps) {
  const navigate = useNavigate()
  const [content, retry] = useFileBlob(file)
  const index = siblings.findIndex((f) => f.id === file.id)
  const previous = index > 0 ? siblings[index - 1] : undefined
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined
  const start = useRef<{ x: number; y: number } | null>(null)

  const go = (target: FileRow | undefined) => {
    if (target) void navigate(filePath(target.id), { replace: true })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Keys belong to an open menu or dialog (rename, move) while there is one.
      if (event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return
      if (event.key === 'ArrowLeft' && previous)
        void navigate(filePath(previous.id), { replace: true })
      if (event.key === 'ArrowRight' && next) void navigate(filePath(next.id), { replace: true })
      if (event.key === 'Escape') void navigate(backTo)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previous, next, backTo, navigate])

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-black text-white">
      <div className="flex items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        <Link to={backTo} className={darkButton} aria-label={t.common.close}>
          <X className="size-6" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          {siblings.length > 1 && index >= 0 && (
            <p className="text-xs text-white/70">{t.files.position(index + 1, siblings.length)}</p>
          )}
        </div>
        <FileMenu
          file={file}
          folders={folders}
          spaceName={spaceName}
          canEdit={canEdit}
          triggerClassName={darkButton}
          onTrashed={() => void navigate(backTo, { replace: true })}
        />
      </div>

      <div
        className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center select-none"
        onPointerDown={(event) => {
          if (event.pointerType !== 'mouse') start.current = { x: event.clientX, y: event.clientY }
        }}
        onPointerUp={(event) => {
          const from = start.current
          start.current = null
          if (!from) return
          const dx = event.clientX - from.x
          if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(event.clientY - from.y)) return
          go(dx < 0 ? next : previous)
        }}
      >
        {content.status === 'ready' ? (
          <img
            src={content.url}
            alt={file.name}
            className="max-h-full max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 text-center text-white/80">
            <ImageIcon className="size-10" aria-hidden="true" />
            <p role="status" className="text-sm">
              {content.status === 'loading'
                ? t.files.downloading(content.percent)
                : content.status === 'offline'
                  ? t.files.notOnDevice
                  : t.files.downloadFailed}
            </p>
            {(content.status === 'error' || content.status === 'offline') && (
              <button type="button" className="btn btn-secondary" onClick={retry}>
                {t.files.retry}
              </button>
            )}
          </div>
        )}
        {previous && (
          <button
            type="button"
            onClick={() => go(previous)}
            className={`absolute top-1/2 left-2 -translate-y-1/2 bg-black/40 ${darkButton}`}
            aria-label={t.files.previous}
          >
            <ChevronLeft className="size-7" aria-hidden="true" />
          </button>
        )}
        {next && (
          <button
            type="button"
            onClick={() => go(next)}
            className={`absolute top-1/2 right-2 -translate-y-1/2 bg-black/40 ${darkButton}`}
            aria-label={t.files.next}
          >
            <ChevronRight className="size-7" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="pb-[env(safe-area-inset-bottom)]" />
    </div>
  )
}

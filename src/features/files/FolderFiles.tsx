import { useDraggable } from '@dnd-kit/core'
import { Image as ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import type { FileRow, FolderRow } from '@/lib/database.types'
import { filePath } from '@/lib/paths'
import { FileMenu } from './FileMenu'
import { FileRowItem, UploadBadge } from './FileRowItem'
import { useFileBlob, useUploadStates, type UploadState } from './hooks'

/** dnd-kit id prefix of a file being dragged onto a folder (desktop). */
export const FILE_DRAG = 'file:'

interface FolderFilesProps {
  /** Files of this folder, already filtered by type and sorted. */
  files: FileRow[]
  folders: FolderRow[]
  spaceName: string
  canEdit: boolean
  draggable: boolean
  now: number
  className?: string
}

/** The files of a folder: images as a gallery, audio and documents as a list. */
export function FolderFiles({
  files,
  folders,
  spaceName,
  canEdit,
  draggable,
  now,
  className = '',
}: FolderFilesProps) {
  const uploads = useUploadStates()
  const images = files.filter((f) => f.kind === 'image')
  const others = files.filter((f) => f.kind !== 'image')
  return (
    <div className={className}>
      {images.length > 0 && (
        <section aria-label={t.files.images}>
          <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
            {images.map((file) => (
              <li key={file.id}>
                <ImageTile file={file} upload={uploads.get(file.id)} draggable={draggable} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-label={t.files.list} className={images.length > 0 ? 'mt-4' : ''}>
          <ul className="flex flex-col gap-1">
            {others.map((file) => (
              <li key={file.id}>
                <DraggableFile
                  file={file}
                  now={now}
                  upload={uploads.get(file.id)}
                  draggable={draggable}
                  actions={
                    <FileMenu
                      file={file}
                      folders={folders}
                      spaceName={spaceName}
                      canEdit={canEdit}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function DraggableFile({
  file,
  now,
  upload,
  draggable,
  actions,
}: {
  file: FileRow
  now: number
  upload: UploadState | undefined
  draggable: boolean
  actions: ReactNode
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${FILE_DRAG}${file.id}`,
    disabled: !draggable,
  })
  return (
    <FileRowItem
      file={file}
      now={now}
      upload={upload}
      actions={actions}
      dragRef={setNodeRef}
      dragProps={{ ...listeners, ...attributes }}
      className={isDragging ? 'opacity-50' : ''}
    />
  )
}

/** True once the element has come near the screen; thumbnails load only then. */
function useNearScreen(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (near || !element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true)
      },
      { rootMargin: '300px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, near])
  return near
}

function ImageTile({
  file,
  upload,
  draggable,
}: {
  file: FileRow
  upload: UploadState | undefined
  draggable: boolean
}) {
  const box = useRef<HTMLAnchorElement | null>(null)
  const near = useNearScreen(box)
  const [content] = useFileBlob(file, near)
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `${FILE_DRAG}${file.id}`,
    disabled: !draggable,
  })
  return (
    <Link
      ref={(node) => {
        box.current = node
        setNodeRef(node)
      }}
      {...listeners}
      {...attributes}
      to={filePath(file.id)}
      aria-label={file.name}
      className={`relative block aspect-square overflow-hidden rounded-xl border border-line bg-canvas touch-manipulation ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      {content.status === 'ready' ? (
        <img src={content.url} alt="" className="size-full object-cover" draggable={false} />
      ) : (
        <span className="flex size-full items-center justify-center text-muted">
          <ImageIcon className="size-6" aria-hidden="true" />
        </span>
      )}
      {upload && (
        <span className="absolute inset-x-1 bottom-1 truncate rounded-md bg-surface/90 px-1.5 py-0.5 text-xs">
          <UploadBadge state={upload} />
        </span>
      )}
    </Link>
  )
}

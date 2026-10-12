import {
  AlertTriangle,
  CloudOff,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Music,
  UploadCloud,
} from 'lucide-react'
import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import type { FileRow } from '@/lib/database.types'
import { formatBytes, formatDuration, isPdf } from '@/lib/files'
import { filePath } from '@/lib/paths'
import { formatRelative } from '@/lib/time'
import type { UploadState } from './hooks'

export function FileKindIcon({ file, className }: { file: FileRow; className: string }) {
  const Icon =
    file.kind === 'audio'
      ? Music
      : file.kind === 'image'
        ? ImageIcon
        : isPdf(file.mime, file.name)
          ? FileText
          : FileIcon
  return <Icon className={className} aria-hidden="true" />
}

export function UploadBadge({ state }: { state: UploadState | undefined }) {
  if (!state) return null
  const [Icon, text, tone] =
    state === 'failed'
      ? [AlertTriangle, t.files.uploadFailed, 'text-danger']
      : state === 'waiting'
        ? [CloudOff, t.files.waiting, 'text-muted']
        : [UploadCloud, t.files.uploading, 'text-accent']
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {text}
    </span>
  )
}

interface FileRowItemProps {
  file: FileRow
  now: number
  /** "Folder principal › Subfolder" (search results). */
  location?: string
  upload?: UploadState
  /** The "⋯" menu (FileMenu). */
  actions?: ReactNode
  dragRef?: Ref<HTMLAnchorElement>
  dragProps?: HTMLAttributes<HTMLAnchorElement>
  className?: string
}

/** An audio file or document in a list: name, size, duration, upload state. */
export function FileRowItem({
  file,
  now,
  location,
  upload,
  actions,
  dragRef,
  dragProps,
  className = '',
}: FileRowItemProps) {
  const when = formatRelative(file.updated_at, now) ?? t.notes.justNow
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-line bg-surface pr-1 pl-3 ${className}`}
    >
      <Link
        ref={dragRef}
        {...dragProps}
        to={filePath(file.id)}
        className="flex min-h-14 min-w-0 flex-1 items-start gap-3 py-2.5 touch-manipulation"
      >
        <FileKindIcon file={file} className="mt-0.5 size-5 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{file.name}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
            {location && <span className="max-w-full truncate">{location}</span>}
            {location && <span aria-hidden="true">·</span>}
            {file.duration_sec !== null && (
              <>
                <span>{formatDuration(file.duration_sec)}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{formatBytes(file.size_bytes)}</span>
            <span aria-hidden="true">·</span>
            <span>{when}</span>
            <UploadBadge state={upload} />
          </span>
        </span>
      </Link>
      {actions}
    </div>
  )
}

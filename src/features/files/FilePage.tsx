import { ChevronRight, Download, ExternalLink, FileWarning } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { pathTo, sortItems } from '@/data/tree'
import { canEditRole, useSortMode, useSpace, useSpaceFolders } from '@/features/folders/hooks'
import { t } from '@/i18n/ro'
import { readBlob } from '@/lib/blobs'
import type { FileRow } from '@/lib/database.types'
import { downloadName, formatBytes, isPdf } from '@/lib/files'
import { folderPath } from '@/lib/paths'
import { useSyncRuntime } from '@/sync/SyncContext'
import { AudioPlayer } from './AudioPlayer'
import { FileMenu } from './FileMenu'
import { FileKindIcon } from './FileRowItem'
import { useFileBlob, useSpaceFiles, useFile, type FileBlobState } from './hooks'
import { ImageViewer } from './ImageViewer'
import { useDownload } from './useDownload'

// pdf.js is large: its own chunk, loaded when a PDF is opened (precached for offline use).
const PdfViewer = lazy(() => import('./PdfViewer'))

/** One file: images on the whole screen, an audio player, PDFs in the app, the rest to save. */
export function FilePage() {
  const { fileId = '' } = useParams()
  const file = useFile(fileId)
  const space = useSpace(file?.space_id ?? '')
  const folders = useSpaceFolders(file?.space_id ?? '')
  const files = useSpaceFiles(file?.space_id ?? '')
  const [sort] = useSortMode()
  const navigate = useNavigate()

  if (file === undefined || (file && (space === undefined || !folders || !files))) return null
  if (!file || file.deleted_at || !space || !folders || !files) {
    return (
      <div className="px-4 py-10">
        <EmptyState icon={FileWarning} title={t.files.list} hint={t.files.notFound} />
        <p className="text-center">
          <Link to="/" className="btn btn-secondary">
            {t.folders.backToFolders}
          </Link>
        </p>
      </div>
    )
  }

  const canEdit = canEditRole(space.role)
  const backTo = folderPath(file.space_id, file.folder_id)
  const menuProps = { file, folders, spaceName: space.name, canEdit }

  if (file.kind === 'image') {
    const siblings = sortItems(
      files.filter((f) => f.kind === 'image' && !f.deleted_at && f.folder_id === file.folder_id),
      sort,
    )
    return <ImageViewer {...menuProps} siblings={siblings} backTo={backTo} />
  }

  return (
    <>
      <PageHeader
        title={file.name}
        backTo={backTo}
        above={
          <nav
            aria-label={t.folders.breadcrumb}
            className="flex flex-wrap items-center gap-1 text-sm text-muted"
          >
            <Link to="/" className="rounded-md px-1 py-1 hover:text-ink">
              {t.folders.title}
            </Link>
            {[
              { id: null, name: space.name },
              ...pathTo(folders, file.folder_id).map((f) => ({ id: f.id, name: f.name })),
            ].map((crumb) => (
              <span key={crumb.id ?? 'root'} className="flex items-center gap-1">
                <ChevronRight className="size-4" aria-hidden="true" />
                <Link
                  to={folderPath(file.space_id, crumb.id)}
                  className="rounded-md px-1 py-1 hover:text-ink"
                >
                  {crumb.name}
                </Link>
              </span>
            ))}
          </nav>
        }
        titleMenu={
          <FileMenu {...menuProps} onTrashed={() => void navigate(backTo, { replace: true })} />
        }
      />
      <div className="mx-auto max-w-4xl px-4 py-4 lg:px-6">
        {file.kind === 'audio' ? (
          <AudioView file={file} />
        ) : isPdf(file.mime, file.name) ? (
          <PdfView file={file} />
        ) : (
          <DocumentView file={file} />
        )}
      </div>
    </>
  )
}

/** Download progress, "not on this device" offline, or an error with a retry. */
function ContentStatus({ state, onRetry }: { state: FileBlobState; onRetry: () => void }) {
  if (state.status === 'ready') return null
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-muted">
      <p role="status">
        {state.status === 'loading'
          ? t.files.downloading(state.percent)
          : state.status === 'offline'
            ? t.files.notOnDevice
            : t.files.downloadFailed}
      </p>
      {state.status !== 'loading' && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t.files.retry}
        </button>
      )}
    </div>
  )
}

function AudioView({ file }: { file: FileRow }) {
  const [content, retry] = useFileBlob(file)
  return content.status === 'ready' ? (
    <AudioPlayer src={content.url} knownDuration={file.duration_sec} />
  ) : (
    <ContentStatus state={content} onRetry={retry} />
  )
}

function PdfView({ file }: { file: FileRow }) {
  const [content, retry] = useFileBlob(file)
  if (content.status !== 'ready') return <ContentStatus state={content} onRetry={retry} />
  return (
    <Suspense fallback={<p className="py-8 text-center text-muted">{t.files.pdfLoading}</p>}>
      <PdfViewer file={content.blob} />
    </Suspense>
  )
}

/** Other documents are not downloaded on sight: "Descarcă" saves, "Deschide" opens. */
function DocumentView({ file }: { file: FileRow }) {
  const { db, storage, notify } = useSyncRuntime()
  const download = useDownload()

  async function open() {
    // The tab is opened before any request, otherwise the browser blocks it as a popup.
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      await download(file)
      return
    }
    tab.opener = null
    try {
      const local = await readBlob(db, file.id)
      const url = local ? URL.createObjectURL(local) : await storage.getUrl(file.storage_path)
      tab.location.href = url
      if (local) setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      tab.close()
      notify({
        kind: 'message',
        text: navigator.onLine ? t.files.downloadFailed : t.common.needsInternet,
      })
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface px-4 py-10 text-center">
      <FileKindIcon file={file} className="size-12 text-muted" />
      <div>
        <p className="font-medium break-all">{downloadName(file.name, file.mime)}</p>
        <p className="text-sm text-muted">{formatBytes(file.size_bytes)}</p>
      </div>
      <p className="max-w-sm text-sm text-muted">{t.files.noPreview}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => void open()}>
          <ExternalLink className="size-4" aria-hidden="true" />
          {t.files.open}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void download(file)}>
          <Download className="size-4" aria-hidden="true" />
          {t.files.download}
        </button>
      </div>
    </div>
  )
}

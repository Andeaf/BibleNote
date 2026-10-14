import { useLiveQuery } from 'dexie-react-hooks'
import { Download } from 'lucide-react'
import { useRef, useState } from 'react'
import { useIsDesktop } from '@/features/folders/hooks'
import { t } from '@/i18n/ro'
import { formatBytes } from '@/lib/files'
import { useSyncRuntime } from '@/sync/SyncContext'
import { buildExportPlan, onlyNotes, type ExportPlan } from './plan'
import { ExportFileError, canStreamToDisk, pickZipTarget, writeZip } from './writeZip'

const zipName = () => `BibleNote-${new Date().toISOString().slice(0, 10)}.zip`

/**
 * "Export" in Settings: the backup as a ZIP. The sizes are shown
 * before anything starts. Recordings can make the full export hundreds of MB, so a phone never
 * builds it: phones export the notes only and are told to make the full export on a computer.
 * Computers stream it to disk where the browser can (Chrome, Edge), else build it in memory.
 */
export function ExportSection() {
  const { db, storage, notify } = useSyncRuntime()
  const isDesktop = useIsDesktop()
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const abort = useRef<AbortController | null>(null)

  const plan = useLiveQuery(
    async () =>
      buildExportPlan(
        {
          spaces: await db.spaces.toArray(),
          folders: await db.folders.toArray(),
          notes: await db.notes.toArray(),
          files: await db.files.toArray(),
        },
        { files: true, untitled: t.notes.untitled },
      ),
    [db],
  )
  const notes = plan ? onlyNotes(plan) : null

  async function run(chosen: ExportPlan) {
    const fileName = zipName()
    // The save dialog must open during the click, before anything else is awaited.
    const target = isDesktop && chosen.files > 0 && canStreamToDisk()
    const stream = target ? await pickZipTarget(fileName) : null
    if (target && !stream) return
    if (!navigator.onLine && chosen.files > 0) {
      const cached = new Set((await db.blobs.toCollection().primaryKeys()) as string[])
      if (chosen.entries.some((e) => e.kind === 'file' && !cached.has(e.id))) {
        await stream?.abort()
        notify({ kind: 'message', text: t.exportZip.needsInternet })
        return
      }
    }
    const controller = new AbortController()
    abort.current = controller
    setProgress({ done: 0, total: chosen.entries.length })
    try {
      await writeZip({
        entries: chosen.entries,
        db,
        storage,
        fileName,
        target: stream,
        preferShare: !isDesktop,
        signal: controller.signal,
        onProgress: (done) => setProgress({ done, total: chosen.entries.length }),
      })
      notify({ kind: 'message', text: t.exportZip.done })
    } catch (error) {
      const text = controller.signal.aborted
        ? t.exportZip.cancelled
        : error instanceof ExportFileError
          ? t.exportZip.fileFailed(error.path.split('/').pop() ?? '')
          : t.exportZip.failed
      notify({ kind: 'message', text })
    } finally {
      abort.current = null
      setProgress(null)
    }
  }

  return (
    <>
      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.exportZip.title}</h2>
      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <p className="text-sm">{t.exportZip.intro}</p>
        {plan && notes && (
          <>
            <p className="mt-2 text-sm text-muted">
              {t.exportZip.summary(formatBytes(plan.bytes), plan.notes, plan.files)}
            </p>
            {!isDesktop && plan.files > 0 && (
              <p className="mt-2 text-sm text-muted">
                {t.exportZip.phoneHint(formatBytes(plan.bytes))}
              </p>
            )}
            {progress ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p role="status" className="text-sm">
                  {t.exportZip.progress(progress.done, progress.total)}
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => abort.current?.abort()}
                >
                  {t.common.cancel}
                </button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {isDesktop && plan.files > 0 && (
                  <button type="button" className="btn btn-primary" onClick={() => void run(plan)}>
                    <Download className="size-4" aria-hidden="true" />
                    {t.exportZip.all}
                  </button>
                )}
                <button
                  type="button"
                  className={`btn ${isDesktop && plan.files > 0 ? 'btn-secondary' : 'btn-primary'}`}
                  disabled={notes.notes === 0}
                  onClick={() => void run(notes)}
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t.exportZip.notesOnly(formatBytes(notes.bytes))}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

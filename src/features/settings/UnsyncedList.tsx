import { useLiveQuery } from 'dexie-react-hooks'
import { Copy, Download } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useDownload } from '@/features/files/useDownload'
import { t } from '@/i18n/ro'
import type { FileRow, NoteRow } from '@/lib/database.types'
import { syncErrorText } from '@/sync/errorText'
import { useSyncRuntime } from '@/sync/SyncContext'
import { ApiError, type OutboxEntry } from '@/sync/types'

interface FailedItem {
  entry: OutboxEntry
  name: string
  /** A file the server never got, still on this device: it can be saved before discarding. */
  file?: FileRow
  /** A note whose text never reached the server: it can be copied before discarding. */
  note?: NoteRow
}

/**
 * "Nesincronizate": changes the server refused, with "Reîncearcă" and "Renunță". Nothing that
 * exists only here is dropped without a way to keep it: an unsent file offers "Descarcă", an
 * unsent note "Copiază textul", and "Renunță" asks first.
 */
export function UnsyncedList({ onMessage }: { onMessage: (text: string | null) => void }) {
  const { db, engine, notify } = useSyncRuntime()
  const download = useDownload()
  const [confirm, setConfirm] = useState<FailedItem | null>(null)

  const failed = useLiveQuery(async (): Promise<FailedItem[]> => {
    const entries = await db.outbox.where('status').equals('failed').sortBy('seq')
    return Promise.all(
      entries.map(async (entry) => {
        const row = (await db.table(entry.table).get(entry.row_id)) as
          (FileRow & NoteRow) | undefined
        const item: FailedItem = { entry, name: row?.name ?? row?.title ?? '' }
        if (row && entry.table === 'files' && entry.op === 'upload') {
          if (await db.blobs.get(entry.row_id)) item.file = row
        }
        if (row && entry.table === 'notes' && entry.op === 'save_note') item.note = row
        return item
      }),
    )
  }, [db])

  async function copyText(note: NoteRow) {
    try {
      await navigator.clipboard.writeText(
        [note.title.trim(), note.content_text].filter(Boolean).join('\n\n'),
      )
      notify({ kind: 'message', text: t.settings.copied })
    } catch {
      notify({ kind: 'message', text: t.settings.copyFailed })
    }
  }

  /** Discarding restores the row from the server, so it usually needs the network. */
  async function discard(seq: number) {
    onMessage(null)
    try {
      await engine.discard(seq)
    } catch (error) {
      const offlineError =
        !navigator.onLine || (error instanceof ApiError && error.kind === 'network')
      onMessage(offlineError ? t.common.needsInternet : syncErrorText(String(error)))
    } finally {
      setConfirm(null)
    }
  }

  const confirmText = (item: FailedItem): string =>
    item.file
      ? t.settings.discardFile(item.name)
      : item.note
        ? t.settings.discardNote(item.name || t.notes.untitled)
        : t.settings.discardOther

  return (
    <>
      <div className="rounded-xl border border-line bg-surface">
        {!failed || failed.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">{t.settings.unsyncedEmpty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {failed.map((item) => (
              <li key={item.entry.seq} className="flex flex-col gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.tables[item.entry.table]}
                    {item.name ? `: ${item.name}` : ''}
                  </p>
                  <p className="text-xs text-danger">{syncErrorText(item.entry.last_error)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.file && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void download(item.file as FileRow)}
                    >
                      <Download className="size-4" aria-hidden="true" />
                      {t.files.download}
                    </button>
                  )}
                  {item.note && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void copyText(item.note as NoteRow)}
                    >
                      <Copy className="size-4" aria-hidden="true" />
                      {t.settings.copyText}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void engine.retry(item.entry.seq as number)}
                  >
                    {t.settings.retry}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary text-danger"
                    onClick={() => setConfirm(item)}
                  >
                    {t.settings.discard}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={t.settings.discardTitle}
        message={confirm ? confirmText(confirm) : ''}
        confirmLabel={t.settings.discard}
        destructive
        onCancel={() => setConfirm(null)}
        onConfirm={() => discard(confirm?.entry.seq as number)}
      />
    </>
  )
}

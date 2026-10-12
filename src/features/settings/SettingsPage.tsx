import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { t } from '@/i18n/ro'
import { syncErrorText } from '@/sync/errorText'
import { useSyncRuntime } from '@/sync/SyncContext'
import { ApiError, type OutboxEntry } from '@/sync/types'
import { StorageSection } from './StorageSection'

interface FailedItem {
  entry: OutboxEntry
  name: string
}

export function SettingsPage() {
  const { session, offline } = useAuth()
  const runtime = useSyncRuntime()
  const { db, engine } = runtime
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const user = session?.user
  const metadata = (user?.user_metadata ?? {}) as { full_name?: string; name?: string }
  const name = metadata.full_name ?? metadata.name ?? null
  const identity = user?.is_anonymous ? t.auth.guest : (user?.email ?? '')

  const failed = useLiveQuery(async (): Promise<FailedItem[]> => {
    const entries = await db.outbox.where('status').equals('failed').sortBy('seq')
    return Promise.all(
      entries.map(async (entry) => {
        const row = (await db.table(entry.table).get(entry.row_id)) as
          { name?: string; title?: string } | undefined
        return { entry, name: row?.name ?? row?.title ?? '' }
      }),
    )
  }, [db])
  const outboxCount = useLiveQuery(() => db.outbox.count(), [db]) ?? 0

  async function signOut() {
    const done = await runtime.signOutAndWipe()
    if (!done) {
      setConfirmSignOut(false)
      setMessage(t.common.needsInternet)
    }
  }

  /** Discarding restores the row from the server, so it needs the network. */
  async function discard(seq: number) {
    setMessage(null)
    try {
      await engine.discard(seq)
    } catch (error) {
      const offlineError =
        !navigator.onLine || (error instanceof ApiError && error.kind === 'network')
      setMessage(offlineError ? t.common.needsInternet : syncErrorText(String(error)))
    }
  }

  return (
    <>
      <PageHeader title={t.settings.title} />
      <section className="mx-auto max-w-2xl px-4 py-4 lg:px-6">
        {message && (
          <p
            role="status"
            className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm"
          >
            {message}
          </p>
        )}
        <h2 className="mb-2 text-sm font-medium text-muted">{t.auth.account}</h2>
        <div className="rounded-xl border border-line bg-surface">
          <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
            <div className="min-w-0">
              {name && <p className="truncate text-sm font-medium">{name}</p>}
              <p className="truncate text-sm text-muted">{identity}</p>
              {offline && <p className="mt-1 text-xs text-muted">{t.auth.offlineSession}</p>}
            </div>
            <button
              type="button"
              onClick={() => setConfirmSignOut(true)}
              className="btn btn-secondary"
            >
              {t.auth.signOut}
            </button>
          </div>
        </div>

        <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.settings.unsynced}</h2>
        <div className="rounded-xl border border-line bg-surface">
          {!failed || failed.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">{t.settings.unsyncedEmpty}</p>
          ) : (
            <ul className="divide-y divide-line">
              {failed.map(({ entry, name: rowName }) => (
                <li
                  key={entry.seq}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {t.tables[entry.table]}
                      {rowName ? `: ${rowName}` : ''}
                    </p>
                    <p className="text-xs text-danger">{syncErrorText(entry.last_error)}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void engine.retry(entry.seq as number)}
                    >
                      {t.settings.retry}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary text-danger"
                      onClick={() => void discard(entry.seq as number)}
                    >
                      {t.settings.discard}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <StorageSection />

        <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
            <dt className="text-sm text-muted">{t.settings.version}</dt>
            <dd className="text-sm font-medium">{__APP_VERSION__}</dd>
          </div>
        </dl>
      </section>

      <ConfirmDialog
        open={confirmSignOut}
        title={t.settings.signOutTitle}
        message={
          outboxCount > 0
            ? `${t.settings.signOutUnsynced(outboxCount)} ${t.settings.signOutHint}`
            : t.settings.signOutHint
        }
        confirmLabel={t.auth.signOut}
        destructive={outboxCount > 0}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={signOut}
      />
    </>
  )
}

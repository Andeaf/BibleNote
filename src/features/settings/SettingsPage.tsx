import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '@/auth/AuthContext'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { t } from '@/i18n/ro'
import { aboutPath, trashPath } from '@/lib/paths'
import { useSyncRuntime } from '@/sync/SyncContext'
import { ExportSection } from '@/features/export/ExportSection'
import { InstallSection } from '@/features/install/Install'
import { AppearanceSection } from './Appearance'
import { StorageSection } from './StorageSection'
import { UnsyncedList } from './UnsyncedList'

export function SettingsPage() {
  const { session, offline } = useAuth()
  const runtime = useSyncRuntime()
  const { db } = runtime
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const user = session?.user
  const metadata = (user?.user_metadata ?? {}) as { full_name?: string; name?: string }
  const name = metadata.full_name ?? metadata.name ?? null
  const identity = user?.is_anonymous ? t.auth.guest : (user?.email ?? '')

  const outboxCount = useLiveQuery(() => db.outbox.count(), [db]) ?? 0

  async function signOut() {
    const done = await runtime.signOutAndWipe()
    if (!done) {
      setConfirmSignOut(false)
      setMessage(t.common.needsInternet)
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

        <AppearanceSection />

        <Link
          to={trashPath}
          className="mt-6 flex min-h-12 items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-2 text-sm hover:bg-canvas"
        >
          <span className="flex items-center gap-3">
            <Trash2 className="size-4 text-muted" aria-hidden="true" />
            {t.trash.title}
          </span>
          <ChevronRight className="size-4 text-muted" aria-hidden="true" />
        </Link>

        <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.settings.unsynced}</h2>
        <UnsyncedList onMessage={setMessage} />

        <StorageSection />

        <ExportSection />

        <InstallSection />

        <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
          <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
            <dt className="text-sm text-muted">{t.settings.version}</dt>
            <dd className="text-sm font-medium">{__APP_VERSION__}</dd>
          </div>
          <div>
            <Link
              to={aboutPath}
              className="flex min-h-12 items-center justify-between gap-4 px-4 py-2 text-sm hover:bg-canvas"
            >
              {t.about.open}
              <ChevronRight className="size-4 text-muted" aria-hidden="true" />
            </Link>
          </div>
        </dl>
      </section>

      <ConfirmDialog
        open={confirmSignOut}
        title={t.settings.signOutTitle}
        message={[
          outboxCount > 0 ? t.settings.signOutUnsynced(outboxCount) : '',
          user?.is_anonymous ? t.settings.signOutGuest : '',
          t.settings.signOutHint,
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={t.auth.signOut}
        destructive={outboxCount > 0}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={signOut}
      />
    </>
  )
}

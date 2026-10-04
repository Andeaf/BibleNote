import { useAuth } from '@/auth/AuthContext'
import { t } from '@/i18n/ro'

export function SettingsPage() {
  const { session, signOut } = useAuth()
  const user = session?.user
  const name =
    (user?.user_metadata as { full_name?: string; name?: string } | undefined)?.full_name ??
    (user?.user_metadata as { name?: string } | undefined)?.name ??
    null
  const identity = user?.is_anonymous ? t.auth.guest : (user?.email ?? '')

  return (
    <section className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">{t.settings.title}</h1>

      <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.auth.account}</h2>
      <div className="rounded-xl border border-line bg-surface">
        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
          <div className="min-w-0">
            {name && <p className="truncate text-sm font-medium">{name}</p>}
            <p className="truncate text-sm text-muted">{identity}</p>
          </div>
          <button type="button" onClick={() => void signOut()} className="btn btn-secondary">
            {t.auth.signOut}
          </button>
        </div>
      </div>

      <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
          <dt className="text-sm text-muted">{t.settings.version}</dt>
          <dd className="text-sm font-medium">{__APP_VERSION__}</dd>
        </div>
      </dl>
    </section>
  )
}

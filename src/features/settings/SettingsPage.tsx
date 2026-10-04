import { t } from '@/i18n/ro'

export function SettingsPage() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold tracking-tight">{t.settings.title}</h1>
      <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
        <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-2">
          <dt className="text-sm text-muted">{t.settings.version}</dt>
          <dd className="text-sm font-medium">{__APP_VERSION__}</dd>
        </div>
      </dl>
    </section>
  )
}

import { t } from '@/i18n/ro'

/** Rendered instead of the app when the Supabase env vars are missing (see docs/SETUP.md). */
export function ConfigMissing() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold tracking-tight">{t.config.missingTitle}</h1>
        <p className="mt-2 text-muted">{t.config.missingHint}</p>
        <pre className="mt-4 rounded-lg bg-surface p-3 text-left text-xs">
          VITE_SUPABASE_URL{'\n'}VITE_SUPABASE_PUBLISHABLE_KEY
        </pre>
      </div>
    </main>
  )
}

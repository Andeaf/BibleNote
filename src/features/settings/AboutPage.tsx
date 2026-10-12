import { PageHeader } from '@/components/PageHeader'
import { t } from '@/i18n/ro'
import { settingsPath } from '@/lib/paths'

const OPEN_BIBLES = 'https://github.com/seven1m/open-bibles'

/** "Despre": the version and the attributions (the Bible text and the fonts). */
export function AboutPage() {
  return (
    <>
      <PageHeader title={t.about.title} backTo={settingsPath} />
      <section className="mx-auto max-w-2xl px-4 py-4 lg:px-6">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <p className="font-semibold">{t.app.name}</p>
          <p className="text-sm text-muted">{t.app.tagline}</p>
          <p className="mt-1 text-sm text-muted">{t.about.version(__APP_VERSION__)}</p>
        </div>

        <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.about.bibleTitle}</h2>
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <p>{t.about.bibleText}</p>
          <p className="mt-2">
            <a
              href={OPEN_BIBLES}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline underline-offset-2"
            >
              {t.about.bibleSource}
            </a>
          </p>
        </div>

        <h2 className="mt-6 mb-2 text-sm font-medium text-muted">{t.about.fontsTitle}</h2>
        <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <p>{t.about.fontsText}</p>
        </div>
      </section>
    </>
  )
}

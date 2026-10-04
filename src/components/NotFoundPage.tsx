import { Compass } from 'lucide-react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Compass className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{t.notFound.title}</h1>
      <Link
        to="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-white"
      >
        {t.notFound.back}
      </Link>
    </section>
  )
}

import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'

interface PageHeaderProps {
  title: string
  /** Where the phone back button goes; omitted on top-level screens. */
  backTo?: string
  /** Desktop-only element above the title (breadcrumb). */
  above?: ReactNode
  actions?: ReactNode
  /** Rendered next to the title (a menu for the current item). */
  titleMenu?: ReactNode
}

/** Sticky top bar on phones, plain heading row on desktop. */
export function PageHeader({ title, backTo, above, actions, titleMenu }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/95 backdrop-blur lg:static lg:border-0 lg:bg-transparent">
      <div className="mx-auto max-w-4xl px-2 lg:px-6 lg:pt-6">
        {above && <div className="hidden lg:block">{above}</div>}
        <div className="flex min-h-14 items-center gap-1">
          {backTo && (
            <Link
              to={backTo}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink lg:hidden"
              aria-label={t.common.back}
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </Link>
          )}
          <h1 className="min-w-0 flex-1 truncate px-2 text-lg font-semibold tracking-tight lg:text-2xl">
            {title}
          </h1>
          {titleMenu}
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </div>
    </header>
  )
}

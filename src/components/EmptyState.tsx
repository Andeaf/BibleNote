import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  hint: string
}

/** Calm placeholder for screens with nothing to show yet: an icon, a title and one guiding sentence. */
export function EmptyState({ icon: Icon, title, hint }: EmptyStateProps) {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-muted">{hint}</p>
    </section>
  )
}

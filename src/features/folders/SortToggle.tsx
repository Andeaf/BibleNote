import { ArrowDownAZ, CalendarClock } from 'lucide-react'
import type { SortMode } from '@/data/tree'
import { t } from '@/i18n/ro'

interface SortToggleProps {
  mode: SortMode
  onChange: (mode: SortMode) => void
}

/**
 * By name or by date. On phones a single 44 px button that switches between the two (the header
 * row must fit at 320 px); from `sm` a two-option group.
 */
export function SortToggle({ mode, onChange }: SortToggleProps) {
  const option = (value: SortMode, label: string) => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={mode === value}
      className={`min-h-9 rounded-md px-3 text-xs font-medium ${
        mode === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
  const current = mode === 'name' ? t.folders.sortName : t.folders.sortDate
  const Icon = mode === 'name' ? ArrowDownAZ : CalendarClock
  return (
    <>
      <button
        type="button"
        onClick={() => onChange(mode === 'name' ? 'date' : 'name')}
        aria-label={`${t.folders.sortBy}: ${current}`}
        title={`${t.folders.sortBy}: ${current}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:text-ink sm:hidden"
      >
        <Icon className="size-5" aria-hidden="true" />
      </button>
      <div
        role="group"
        aria-label={t.folders.sortBy}
        className="hidden items-center gap-0.5 rounded-lg bg-accent-soft/60 p-0.5 sm:flex"
      >
        {option('name', t.folders.sortName)}
        {option('date', t.folders.sortDate)}
      </div>
    </>
  )
}

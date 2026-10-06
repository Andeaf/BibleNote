import type { SortMode } from '@/data/tree'
import { t } from '@/i18n/ro'

interface SortToggleProps {
  mode: SortMode
  onChange: (mode: SortMode) => void
}

/** Two-way toggle: by name or by date. */
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
  return (
    <div
      role="group"
      aria-label={t.folders.sortBy}
      className="flex items-center gap-0.5 rounded-lg bg-accent-soft/60 p-0.5"
    >
      {option('name', t.folders.sortName)}
      {option('date', t.folders.sortDate)}
    </div>
  )
}

import { X } from 'lucide-react'
import { Link } from 'react-router'
import { t } from '@/i18n/ro'
import { tagColor } from '@/lib/tags'

interface TagChipProps {
  tag: string
  /** Opens the tag's notes. */
  to?: string
  onRemove?: () => void
  /** Selected state, for filter chips. */
  selected?: boolean
  onClick?: () => void
  small?: boolean
}

/** "#rugăciune" in its colour (from the letters, the same on every device). */
export function TagChip({ tag, to, onRemove, selected, onClick, small }: TagChipProps) {
  const base = `bn-tag bn-tag-${tagColor(tag)} inline-flex max-w-full items-center rounded-full font-medium ${
    small ? 'px-2 py-0.5 text-xs' : 'min-h-8 px-3 text-sm'
  } ${selected ? 'ring-2 ring-current' : ''}`
  const label = <span className="truncate">#{tag}</span>
  if (to) {
    return (
      <Link to={to} className={`${base} min-h-11`}>
        {label}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={`${base} min-h-11`}
      >
        {label}
      </button>
    )
  }
  return (
    <span className={`${base} ${onRemove ? 'pr-0' : ''}`}>
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t.notes.removeTag(tag)}
          className="-my-2 flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  )
}

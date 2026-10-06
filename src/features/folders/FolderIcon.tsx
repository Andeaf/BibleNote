import { DEFAULT_COLOR } from './palette'

interface FolderIconProps {
  emoji: string | null
  color: string | null
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'size-7 rounded-md text-sm',
  md: 'size-10 rounded-xl text-xl',
  lg: 'size-14 rounded-2xl text-3xl',
}

/** Coloured tile with the folder's emoji (or a plain folder glyph). */
export function FolderIcon({ emoji, color, size = 'md' }: FolderIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ${SIZES[size]}`}
      style={{ background: color ?? DEFAULT_COLOR }}
    >
      {emoji ?? '📁'}
    </span>
  )
}

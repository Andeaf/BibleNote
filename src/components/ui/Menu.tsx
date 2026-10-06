import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal, type LucideIcon } from 'lucide-react'
import { t } from '@/i18n/ro'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  destructive?: boolean
  onSelect: () => void
}

interface MenuProps {
  items: MenuItem[]
  /** Accessible name of the trigger, e.g. "Meniu pentru X". */
  label?: string
}

/** The "⋯" menu used on every list item. Keyboard and screen-reader friendly through Radix. */
export function Menu({ items, label }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink data-[state=open]:bg-canvas"
        aria-label={label ?? t.common.menu}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal className="size-5" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-lg data-[state=open]:animate-[bn-fade-in_120ms_ease-out]"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={`flex min-h-11 cursor-default items-center gap-3 rounded-lg px-3 text-sm outline-none data-[highlighted]:bg-canvas ${
                item.destructive ? 'text-danger' : ''
              }`}
            >
              {item.icon && <item.icon className="size-4" aria-hidden="true" />}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

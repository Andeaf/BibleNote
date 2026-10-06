import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { t } from '@/i18n/ro'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}

/**
 * One dialog for both form factors: a bottom sheet on phones, a centred modal from `lg`.
 * Built on Radix Dialog (focus trap, Escape, ARIA); no separate sheet library.
 */
export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-[bn-fade-in_150ms_ease-out]" />
        <RadixDialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-xl data-[state=open]:animate-[bn-sheet-up_200ms_ease-out] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:w-full lg:max-w-md lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-2xl lg:data-[state=open]:animate-[bn-fade-in_150ms_ease-out]">
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-lg font-semibold tracking-tight">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              className="-mt-1 -mr-2 flex size-11 items-center justify-center rounded-lg text-muted hover:text-ink"
              aria-label={t.common.close}
            >
              <X className="size-5" aria-hidden="true" />
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-muted">
              {description}
            </RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

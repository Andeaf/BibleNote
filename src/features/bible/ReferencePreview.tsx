import * as Popover from '@radix-ui/react-popover'
import { X } from 'lucide-react'
import { useMemo } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { useIsDesktop } from '@/features/folders/hooks'
import { t } from '@/i18n/ro'
import { formatRef } from './parser'
import { Passage } from './Passage'
import type { ReferenceClick } from './references'
import { useVerses, type VerseText } from './text'

/** Follows the reference while the page scrolls; its last place once the editor redrew it. */
function anchorOf(element: HTMLElement) {
  let last = element.getBoundingClientRect()
  return {
    current: {
      getBoundingClientRect: () => {
        if (element.isConnected) last = element.getBoundingClientRect()
        return last
      },
    },
  }
}

interface ReferencePreviewProps {
  click: ReferenceClick
  /** False for readers: no "Inserează în notiță". */
  canInsert: boolean
  onInsert: (click: ReferenceClick, verses: VerseText[]) => void
  onClose: () => void
}

/**
 * The text of a reference tapped in a note: a popover next to it on desktop, a bottom sheet on
 * phones (docs/PLAN.md §5.9). A whole chapter shows all of it. On desktop the editor keeps the
 * caret: typing goes on, and the popover closes with the next change, a click elsewhere or
 * Escape.
 */
export function ReferencePreview({ click, canInsert, onInsert, onClose }: ReferencePreviewProps) {
  const isDesktop = useIsDesktop()
  const state = useVerses(click.ref)
  const label = formatRef(click.ref)
  const anchor = useMemo(() => anchorOf(click.element), [click])

  const insert = canInsert && (
    <button
      type="button"
      className="btn btn-primary"
      disabled={state.status !== 'ready'}
      onClick={() => state.status === 'ready' && onInsert(click, state.verses)}
    >
      {t.bible.insert}
    </button>
  )

  if (!isDesktop) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()} title={label}>
        <Passage reference={click.ref} state={state} />
        {insert && <div className="mt-5 flex justify-end">{insert}</div>}
      </Dialog>
    )
  }

  return (
    <Popover.Root open onOpenChange={(open) => !open && onClose()}>
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-40 flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-[28rem] max-w-[calc(100vw-1.5rem)] flex-col rounded-xl border border-line bg-surface shadow-xl data-[state=open]:animate-[bn-fade-in_120ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line py-1 pr-1 pl-4">
            <Popover.Title className="font-semibold">{label}</Popover.Title>
            <Popover.Close
              className="flex size-11 items-center justify-center rounded-lg text-muted hover:text-ink"
              aria-label={t.common.close}
            >
              <X className="size-5" aria-hidden="true" />
            </Popover.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <Passage reference={click.ref} state={state} />
          </div>
          {insert && (
            <div className="flex justify-end border-t border-line px-3 py-2">{insert}</div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders a floating notice into the shared `#bn-notices` stack (index.html): one fixed column
 * above the phone bottom navigation, so toasts and the update prompt stack instead of overlapping.
 * Items must re-enable pointer events (the stack itself lets clicks through).
 */
export function NoticeStack({ children }: { children: ReactNode }) {
  const target = typeof document === 'undefined' ? null : document.getElementById('bn-notices')
  return target ? createPortal(children, target) : null
}

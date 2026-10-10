import { useEffect, useState } from 'react'

/**
 * Height of the on-screen keyboard (0 when closed), from `visualViewport`:
 * innerHeight − (visualViewport.height + visualViewport.offsetTop). The phone toolbar sits this
 * far from the bottom, right above the keyboard, on iPhone and Android alike.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!active || !viewport) return
    const update = () =>
      setInset(Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop))))
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [active])
  return active ? inset : 0
}

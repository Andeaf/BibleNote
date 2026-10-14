import { useSyncExternalStore } from 'react'

/**
 * Installing the app: Chrome and Edge (Android, computers) offer
 * `beforeinstallprompt`, kept here for the "Instalează aplicația" button; Safari on iPhone has
 * no such event, so the app shows the steps (Distribuie → Adaugă pe ecranul principal).
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
export const isIos = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** Opened from the home screen / as an installed app. */
export const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  ((typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true)

/** Listens from the start: the event fires once, early, whatever page is open. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

export async function promptInstall(): Promise<void> {
  const event = deferred
  if (!event) return
  await event.prompt()
  await event.userChoice.catch(() => undefined)
  // The event works once; the browser sends a new one if the user said no.
  deferred = null
  emit()
}

/** Whether the browser can show its install dialog now. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => deferred !== null,
    () => false,
  )
}

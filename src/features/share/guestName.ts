/**
 * The name a guest gave on their first link, kept on this device (a guest has no account and no
 * profile name). Every later link opened here uses it without asking again.
 */
const KEY = 'bn-guest-name'

export function readGuestName(): string | null {
  try {
    return localStorage.getItem(KEY)?.trim() || null
  } catch {
    return null
  }
}

export function writeGuestName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim().slice(0, 60))
  } catch {
    /* storage unavailable: the name is asked again next time */
  }
}

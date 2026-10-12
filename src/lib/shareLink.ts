import { joinPath } from './paths'

/** Tokens are 32 random bytes in base64url (43 characters); older ones may be shorter. */
const TOKEN = '[A-Za-z0-9_-]{20,}'

/**
 * The share token in anything pasted: a full link ("https://…/s/<token>"), the link inside a
 * longer message, or the bare token. Null when there is none.
 */
export function extractShareToken(text: string): string | null {
  const trimmed = text.trim()
  const inLink = new RegExp(`/s/(${TOKEN})`).exec(trimmed)
  if (inLink) return inLink[1] ?? null
  return new RegExp(`^${TOKEN}$`).test(trimmed) ? trimmed : null
}

/** The address of a share link on this site. */
export const shareUrl = (token: string, origin = window.location.origin): string =>
  `${origin}${joinPath(token)}`

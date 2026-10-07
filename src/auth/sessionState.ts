import type { Session } from '@supabase/supabase-js'
import type { KeyValueStore } from './allowedAccess'

/**
 * The session as supabase-js persists it in localStorage. auth-js keeps it when a refresh fails
 * for lack of network, and removes it (emitting SIGNED_OUT) when the server rejects the refresh
 * token or on an explicit sign-out. So "a stored session with a refresh token" means: this
 * device is still signed in, possibly offline.
 */
export interface StoredSession {
  access_token?: unknown
  refresh_token?: unknown
  expires_at?: unknown
  user?: { id?: unknown; email?: unknown } | null
}

/** Same key supabase-js uses by default: `sb-<project ref>-auth-token`. */
export function supabaseStorageKey(supabaseUrl: string): string {
  try {
    return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
  } catch {
    return 'sb-unknown-auth-token'
  }
}

export function readStoredSession(store: KeyValueStore | null, key: string): StoredSession | null {
  try {
    const raw = store?.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as StoredSession) : null
  } catch {
    return null
  }
}

/** A stored session the app may open offline: it has a refresh token and a user id. */
export function usableStoredSession(stored: StoredSession | null): Session | null {
  if (!stored) return null
  const refresh = stored.refresh_token
  const userId = stored.user?.id
  if (typeof refresh !== 'string' || refresh.length === 0) return null
  if (typeof userId !== 'string' || userId.length === 0) return null
  return stored as unknown as Session
}

export type AuthDecision =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** offline = opened from the stored session; the server has not confirmed it yet. */
  | { status: 'signed_in'; session: Session; offline: boolean }

/**
 * - a live session from supabase-js: signed in;
 * - otherwise a stored session with a refresh token: signed in offline, local data opens and
 *   supabase-js refreshes it by itself when the network is back;
 * - otherwise signed out, once supabase-js has reported its initial state (before that, only
 *   while no stored session exists, "loading": this needs no network unless an OAuth code is
 *   being exchanged).
 * Explicit sign-out and a refresh token rejected by the server both clear the stored session,
 * so both lead to signed out; local data and the outbox are kept in the second case.
 */
export function decideAuth(input: {
  live: Session | null | undefined
  stored: StoredSession | null
}): AuthDecision {
  if (input.live) return { status: 'signed_in', session: input.live, offline: false }
  const stored = usableStoredSession(input.stored)
  if (stored) return { status: 'signed_in', session: stored, offline: true }
  return input.live === undefined ? { status: 'loading' } : { status: 'signed_out' }
}

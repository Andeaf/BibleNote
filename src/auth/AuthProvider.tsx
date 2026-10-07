import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { browserStore, readCachedAllowed, resolveAllowed } from './allowedAccess'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { authErrorMessage } from './authErrors'
import { decideAuth, readStoredSession, supabaseStorageKey } from './sessionState'

const RECONNECT_INTERVAL_MS = 30_000

/**
 * Keeps the session in React state, local-first:
 * - the app opens straight from the session stored on this device (no network needed); if
 *   supabase-js cannot confirm it (offline, expired access token) the user is "signed in
 *   offline" with their local data;
 * - when the network is back the session refreshes by itself and sync resumes;
 * - only an explicit sign-out or a refresh token rejected by the server (both clear the stored
 *   session) lead to the login screen, and local data is kept in the second case.
 * It also answers "may this user create main folders?" (is_allowed_email), cached per account.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => browserStore(), [])
  const storageKey = useMemo(() => supabaseStorageKey(import.meta.env.VITE_SUPABASE_URL ?? ''), [])
  // undefined = supabase-js has not reported its initial state yet
  const [live, setLive] = useState<Session | null | undefined>(undefined)
  const [stored, setStored] = useState(() => readStoredSession(store, storageKey))
  const [access, setAccess] = useState<{ userId: string; allowed: boolean } | null>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setLive(next)
      // auth-js has already written or cleared storage when it notifies.
      setStored(readStoredSession(store, storageKey))
      // After the Google redirect the URL still carries ?code=…; drop it.
      if (event === 'SIGNED_IN' && window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [store, storageKey])

  const decision = decideAuth({ live, stored })
  const session = decision.status === 'signed_in' ? decision.session : null
  const offline = decision.status === 'signed_in' && decision.offline
  const userId = session?.user.id

  // Signed in offline: try to refresh as soon as the network is back (and every 30 s while
  // visible). Success emits TOKEN_REFRESHED, a rejection emits SIGNED_OUT.
  useEffect(() => {
    if (!offline) return
    const reconnect = () => {
      if (navigator.onLine) void supabase.auth.getSession()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconnect()
    }
    const timer = setInterval(onVisible, RECONNECT_INTERVAL_MS)
    window.addEventListener('online', reconnect)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', reconnect)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [offline])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const check = () => {
      void resolveAllowed(userId, () => supabase.rpc('is_allowed_email'), store).then((result) => {
        if (!cancelled && result.fromServer && result.allowed !== null) {
          setAccess({ userId, allowed: result.allowed })
        }
      })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    check()
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.removeEventListener('online', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // Re-check once the session is confirmed by the server (offline -> online).
  }, [userId, store, offline])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: decision.status,
      session,
      offline,
      // This session's server answer, else the last answer cached for this account, else unknown.
      allowed: !userId
        ? null
        : access?.userId === userId
          ? access.allowed
          : readCachedAllowed(store, userId),
      signInWithGoogle: async () => {
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: `${window.location.origin}/` },
        })
      },
      signInWithPassword: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return error ? authErrorMessage(error) : null
      },
      signOut: async () => {
        // Local scope only: never log the user out of their other devices. auth-js keeps the
        // session when the request fails for lack of network, so report it instead of pretending.
        if (!navigator.onLine) return false
        const { error } = await supabase.auth.signOut({ scope: 'local' })
        return !error
      },
    }),
    [decision.status, session, offline, userId, access, store],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

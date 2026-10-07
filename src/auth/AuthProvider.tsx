import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { browserStore, readCachedAllowed, resolveAllowed } from './allowedAccess'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { authErrorMessage } from './authErrors'

/**
 * Keeps the Supabase session in React state and answers "may this user create main folders?"
 * through the is_allowed_email RPC. The answer never gates the app (local-first: offline the
 * user still sees their data); it is cached per account and refreshed when the device comes
 * back online. Anonymous guests (phase 4) are never "allowed"; they get spaces through links.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still loading the persisted session
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [access, setAccess] = useState<{ userId: string; allowed: boolean } | null>(null)
  const store = useMemo(() => browserStore(), [])

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      // After the Google redirect the URL still carries ?code=…; drop it.
      if (event === 'SIGNED_IN' && window.location.search.includes('code=')) {
        window.history.replaceState(null, '', window.location.pathname)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
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
  }, [userId, store])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session === undefined ? 'loading' : session ? 'signed_in' : 'signed_out',
      session: session ?? null,
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
        // Local scope only: signing out here must never log the user out of their other devices.
        await supabase.auth.signOut({ scope: 'local' })
      },
    }),
    [session, userId, access, store],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

import type { Session } from '@supabase/supabase-js'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { AuthContext, type AuthContextValue } from './AuthContext'
import { authErrorMessage } from './authErrors'

/**
 * Keeps the Supabase session in React state and answers "may this user create main folders?"
 * through the is_allowed_email RPC. Anonymous guests (phase 4) are never "allowed"; they get
 * their spaces through links instead.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still loading the persisted session
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [access, setAccess] = useState<{ userId: string; allowed: boolean } | null>(null)

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
    void supabase.rpc('is_allowed_email').then(({ data, error }) => {
      if (!cancelled) setAccess({ userId, allowed: !error && data === true })
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = useMemo<AuthContextValue>(
    () => ({
      status: session === undefined ? 'loading' : session ? 'signed_in' : 'signed_out',
      session: session ?? null,
      allowed: userId && access?.userId === userId ? access.allowed : null,
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
        await supabase.auth.signOut()
      },
    }),
    [session, userId, access],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

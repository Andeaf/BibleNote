import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthStatus = 'loading' | 'signed_out' | 'signed_in'

export interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  /**
   * Signed in from the stored session without the server confirming it yet (offline, or the
   * server unreachable). Local data is open; actions that need the server say so.
   */
  offline: boolean
  /** Whether the signed-in user may create main folders (email in allowed_emails). null = not known yet. */
  allowed: boolean | null
  signInWithGoogle: () => Promise<void>
  /** Resolves with a Romanian error message, or null on success. */
  signInWithPassword: (email: string, password: string) => Promise<string | null>
  /** Ends the session on this device only. Resolves false when it needs the network. */
  signOut: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

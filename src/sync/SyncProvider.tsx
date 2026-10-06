import { useEffect, useMemo, type ReactNode } from 'react'
import { useAuth } from '@/auth/AuthContext'
import { createSyncRuntime } from './runtime'
import { SyncContext } from './SyncContext'

/**
 * Opens the account's local database and runs the sync engine for as long as the user is
 * signed in. Mounted inside RequireAuth, so a session always exists here.
 */
export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const accessToken = session?.access_token ?? null

  const runtime = useMemo(() => createSyncRuntime(userId), [userId])

  useEffect(() => {
    runtime.start(accessToken)
    return () => runtime.stop()
    // The token is refreshed through onAuthStateChange inside the runtime; only the account
    // identity should restart the runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  return <SyncContext value={runtime}>{children}</SyncContext>
}

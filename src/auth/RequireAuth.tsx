import { Navigate, Outlet, useLocation } from 'react-router'
import { FullScreenSpinner } from '@/components/FullScreenSpinner'
import { SyncProvider } from '@/sync/SyncProvider'
import { useAuth } from './AuthContext'

/**
 * Route guard for the app shell: signed out -> /login, any signed-in account -> the app with
 * its local database and sync engine. Whether the account may create main folders (allowed)
 * only affects the Folders page, never access: offline the user must still see their data,
 * and link guests (phase 4) are never "allowed". The spinner covers only the restore of the
 * persisted session, which needs no network.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullScreenSpinner />
  if (status === 'signed_out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return (
    <SyncProvider>
      <Outlet />
    </SyncProvider>
  )
}

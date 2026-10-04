import { Navigate, Outlet, useLocation } from 'react-router'
import { FullScreenSpinner } from '@/components/FullScreenSpinner'
import { NoAccessPage } from '@/features/auth/NoAccessPage'
import { useAuth } from './AuthContext'

/**
 * Route guard for the app shell: signed out -> /login; signed in but not allowed to create
 * main folders -> "Nu ai acces încă" (phase 4 adds "Partajate cu mine" for link guests).
 */
export function RequireAuth() {
  const { status, allowed } = useAuth()
  const location = useLocation()

  if (status === 'loading' || (status === 'signed_in' && allowed === null)) {
    return <FullScreenSpinner />
  }
  if (status === 'signed_out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (!allowed) {
    return <NoAccessPage />
  }
  return <Outlet />
}

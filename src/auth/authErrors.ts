import type { AuthError } from '@supabase/supabase-js'
import { t } from '@/i18n/ro'

/** Maps a Supabase auth error to the Romanian message shown to the user. */
export function authErrorMessage(error: AuthError): string {
  const code = error.code ?? ''
  const message = error.message.toLowerCase()
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return t.auth.errors.invalidCredentials
  }
  if (code === 'email_not_confirmed') {
    return t.auth.errors.emailNotConfirmed
  }
  if (message.includes('fetch') || message.includes('network')) {
    return t.auth.errors.network
  }
  return t.auth.errors.generic
}

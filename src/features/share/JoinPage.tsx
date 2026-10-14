import type { User } from '@supabase/supabase-js'
import { Users } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '@/auth/AuthContext'
import { FullScreenSpinner } from '@/components/FullScreenSpinner'
import { t } from '@/i18n/ro'
import { folderPath } from '@/lib/paths'
import { shareApi } from '@/sync/shareApi'
import { ApiError } from '@/sync/types'
import { readGuestName, writeGuestName } from './guestName'

/** The name an account shows to the others in a shared folder. */
function accountName(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string }
  return meta.full_name ?? meta.name ?? user.email?.split('@')[0] ?? null
}

function joinError(error: unknown): string {
  if (!navigator.onLine || (error instanceof ApiError && error.kind === 'network')) {
    return t.common.needsInternet
  }
  if (error instanceof ApiError && error.message.includes('BN_INVALID_LINK')) {
    return t.share.invalidLink
  }
  return t.share.actionFailed
}

/**
 * `/s/<token>`. Signed in (an account, or a guest who already gave a name):
 * enters at once. Otherwise asks for a name first, then signs in as a guest (Supabase anonymous
 * sign-in, used only here) and enters. The name stays on this device. The link is replaced by
 * the folder's address, so the token does not remain in the history.
 */
export function JoinPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { status, session, signInAsGuest } = useAuth()
  const [name, setName] = useState(() => readGuestName() ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const user = session?.user
  const guest = user?.is_anonymous === true
  // A guest without a stored name is asked first; everyone else enters at once.
  const autoJoin = status === 'signed_in' && (!guest || readGuestName() !== null)

  useEffect(() => {
    if (!autoJoin || started.current || !user) return
    started.current = true
    const displayName = guest ? readGuestName() : accountName(user)
    shareApi.joinByToken(token, displayName).then(
      (joined) => void navigate(folderPath(joined.space_id, null), { replace: true }),
      (failure: unknown) => {
        setError(joinError(failure))
        setBusy(false)
      },
    )
  }, [autoJoin, guest, user, token, navigate])

  if (status === 'loading') return <FullScreenSpinner />

  async function submit(event: FormEvent) {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    if (!navigator.onLine) {
      setError(t.common.needsInternet)
      return
    }
    setBusy(true)
    setError(null)
    writeGuestName(clean)
    if (status !== 'signed_in') {
      // Signed in, the page renders again and enters with the stored name.
      const message = await signInAsGuest()
      if (message) {
        setError(message)
        setBusy(false)
      }
      return
    }
    try {
      const joined = await shareApi.joinByToken(token, clean)
      void navigate(folderPath(joined.space_id, null), { replace: true })
    } catch (failure) {
      setError(joinError(failure))
      setBusy(false)
    }
  }

  const joining = autoJoin && !error

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Users className="size-8" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{t.share.joinTitle}</h1>
          {!joining && <p className="mt-1 text-muted">{t.share.joinHint}</p>}
        </div>

        {joining ? (
          <p role="status" className="text-center text-muted">
            {t.share.joining}
          </p>
        ) : error && autoJoin ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
            <Link to="/" className="btn btn-secondary">
              {t.folders.backToFolders}
            </Link>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t.share.nameLabel}</span>
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="input"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="btn btn-primary mt-1 w-full"
            >
              {t.share.join}
            </button>
            {status === 'signed_out' && (
              <Link to="/login" className="mt-4 text-center text-sm text-muted underline">
                {t.share.haveAccount}
              </Link>
            )}
          </form>
        )}
      </div>
    </main>
  )
}

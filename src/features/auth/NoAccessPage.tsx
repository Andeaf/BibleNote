import { KeyRound } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { t } from '@/i18n/ro'

/** Shown to a signed-in account whose email is not in allowed_emails. */
export function NoAccessPage() {
  const { session, signOut } = useAuth()
  const email = session?.user.email

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <section className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          <KeyRound className="size-7" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t.auth.noAccessTitle}</h1>
        <p className="mt-2 text-muted">{t.auth.noAccessHint}</p>
        {email && <p className="mt-4 text-sm text-muted">{email}</p>}
        <button type="button" onClick={() => void signOut()} className="btn btn-secondary mt-8">
          {t.auth.signOut}
        </button>
      </section>
    </main>
  )
}

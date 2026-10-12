import { KeyRound } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { t } from '@/i18n/ro'

/**
 * Empty state of the Folders page for an account that the server says may not create main
 * folders and that has none through links either. The "paste a link" field sits below it, on
 * the Folders page.
 */
export function NoAccessState() {
  return <EmptyState icon={KeyRound} title={t.auth.noAccessTitle} hint={t.auth.noAccessHint} />
}

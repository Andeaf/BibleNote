import { Search } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { t } from '@/i18n/ro'

export function SearchPage() {
  return <EmptyState icon={Search} title={t.search.title} hint={t.search.empty} />
}

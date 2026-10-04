import { Tag } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { t } from '@/i18n/ro'

export function TagsPage() {
  return <EmptyState icon={Tag} title={t.tags.title} hint={t.tags.empty} />
}

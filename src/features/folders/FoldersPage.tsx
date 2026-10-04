import { FolderPlus } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { t } from '@/i18n/ro'

export function FoldersPage() {
  return <EmptyState icon={FolderPlus} title={t.folders.title} hint={t.folders.empty} />
}

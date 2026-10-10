import { t } from '@/i18n/ro'

/** Romanian text for a sync error code stored on a failed outbox entry. */
export function syncErrorText(error: string | null): string {
  const code = error ?? ''
  if (
    code === 'BN_NO_ROWS' ||
    /BN_FORBIDDEN|42501|row-level security|permission denied/i.test(code)
  ) {
    return t.sync.errors.noRows
  }
  if (code.includes('BN_FOLDER_DELETED')) return t.sync.errors.folderDeleted
  if (code.includes('BN_FOLDER_NOT_IN_SPACE')) return t.sync.errors.folderNotInSpace
  if (code.includes('BN_FOLDER_CYCLE')) return t.sync.errors.cycle
  return t.sync.errors.generic(code.slice(0, 80) || '?')
}

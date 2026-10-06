import type { WritableTable } from './types'

/**
 * Columns the client may send, mirroring the grants in supabase/migrations/..._rls.sql.
 * Anything else in a payload is dropped before the request, so a stray field can never turn
 * into a 42501 "permission denied for column".
 */
export const INSERT_COLUMNS: Record<WritableTable, readonly string[]> = {
  spaces: ['id', 'owner_id', 'name', 'color', 'emoji', 'deleted_at'],
  folders: [
    'id',
    'space_id',
    'parent_id',
    'name',
    'color',
    'emoji',
    'created_by',
    'updated_by',
    'deleted_at',
  ],
  // Notes are inserted through save_note (phase 2), never directly.
  notes: [],
  files: [
    'id',
    'space_id',
    'folder_id',
    'name',
    'kind',
    'mime',
    'size_bytes',
    'storage_path',
    'duration_sec',
    'created_by',
    'deleted_at',
  ],
}

export const UPDATE_COLUMNS: Record<WritableTable, readonly string[]> = {
  spaces: ['name', 'color', 'emoji', 'deleted_at'],
  folders: ['parent_id', 'name', 'color', 'emoji', 'deleted_at', 'updated_by'],
  notes: ['folder_id', 'pinned', 'deleted_at'],
  files: ['folder_id', 'name', 'deleted_at'],
}

/** The column that points at the parent folder; nulled when the folder no longer exists. */
export const PARENT_COLUMN: Record<WritableTable, string | null> = {
  spaces: null,
  folders: 'parent_id',
  notes: 'folder_id',
  files: 'folder_id',
}

export function pickColumns(
  payload: Record<string, unknown>,
  columns: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of columns) {
    if (column in payload) out[column] = payload[column]
  }
  return out
}

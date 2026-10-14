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
  // Notes are inserted through save_note, never directly.
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
  // Created by a trigger with the account.
  profiles: [],
}

export const UPDATE_COLUMNS: Record<WritableTable, readonly string[]> = {
  spaces: ['name', 'color', 'emoji', 'deleted_at'],
  folders: ['parent_id', 'name', 'color', 'emoji', 'deleted_at', 'updated_by'],
  notes: ['folder_id', 'pinned', 'deleted_at'],
  files: ['folder_id', 'name', 'deleted_at'],
  // display_name is granted too, but the app sets names per space (set_display_name).
  profiles: ['settings'],
}

/**
 * save_note payloads (the RPC reads these keys from its jsonb argument). A new note sends the
 * whole row; an existing one only the content: save_note never touches folder_id, pinned or
 * deleted_at on update, those go through `update` entries.
 */
export const SAVE_NOTE_CREATE_COLUMNS = [
  'id',
  'space_id',
  'folder_id',
  'title',
  'content',
  'content_text',
  'tags',
  'pinned',
  'deleted_at',
] as const
export const SAVE_NOTE_CONTENT_COLUMNS = ['title', 'content', 'content_text', 'tags'] as const

/** The column that points at the parent folder; nulled when the folder no longer exists. */
export const PARENT_COLUMN: Record<WritableTable, string | null> = {
  spaces: null,
  folders: 'parent_id',
  notes: 'folder_id',
  files: 'folder_id',
  profiles: null,
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

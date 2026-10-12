/**
 * Hand-written mirror of supabase/migrations. Keep it in sync with the SQL.
 * Shape follows what `supabase gen types typescript` produces so it can be swapped later.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type SpaceRole = 'viewer' | 'editor' | 'owner'
export type MemberRole = 'viewer' | 'editor'
export type FileKind = 'audio' | 'image' | 'document'

export type ProfileRow = {
  id: string
  display_name: string | null
  settings: Json
  created_at: string
  updated_at: string
}

export type SpaceRow = {
  id: string
  owner_id: string
  name: string
  color: string | null
  emoji: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** When the server saw it go into the trash (trigger, server clock); the 30 days count from it. */
  trashed_at?: string | null
  purged_at: string | null
}

export type FolderRow = {
  id: string
  space_id: string
  parent_id: string | null
  name: string
  color: string | null
  emoji: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** When the server saw it go into the trash (trigger, server clock); the 30 days count from it. */
  trashed_at?: string | null
  purged_at: string | null
}

export type NoteRow = {
  id: string
  space_id: string
  folder_id: string | null
  title: string
  content: Json
  content_text: string
  tags: string[]
  pinned: boolean
  version: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** When the server saw it go into the trash (trigger, server clock); the 30 days count from it. */
  trashed_at?: string | null
  purged_at: string | null
}

export type FileRow = {
  id: string
  space_id: string
  folder_id: string | null
  name: string
  kind: FileKind
  mime: string
  size_bytes: number
  storage_path: string
  duration_sec: number | null
  created_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  /** When the server saw it go into the trash (trigger, server clock); the 30 days count from it. */
  trashed_at?: string | null
  purged_at: string | null
}

export type ShareLinkRow = {
  id: string
  space_id: string
  role: MemberRole
  token: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export type SpaceMemberRow = {
  id: string
  space_id: string
  user_id: string
  role: MemberRole
  display_name: string | null
  link_id: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Insert/Update types mirror the column grants in supabase/migrations/..._rls.sql
 * (docs/PLAN.md §3.2): the client can only send these columns. Everything else is set by
 * triggers or by security definer RPCs. `never` = not allowed from the client at all.
 */
type Insertable<Row, Required extends keyof Row, Optional extends keyof Row> = Pick<Row, Required> &
  Partial<Pick<Row, Optional>>

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: never
        Update: Partial<Pick<ProfileRow, 'display_name' | 'settings'>>
        Relationships: []
      }
      allowed_emails: {
        Row: { email: string }
        Insert: { email: string }
        Update: { email?: string }
        Relationships: []
      }
      spaces: {
        Row: SpaceRow
        Insert: Insertable<SpaceRow, 'owner_id' | 'name', 'id' | 'color' | 'emoji' | 'deleted_at'>
        Update: Partial<Pick<SpaceRow, 'name' | 'color' | 'emoji' | 'deleted_at'>>
        Relationships: []
      }
      folders: {
        Row: FolderRow
        Insert: Insertable<
          FolderRow,
          'space_id' | 'name',
          'id' | 'parent_id' | 'color' | 'emoji' | 'created_by' | 'updated_by' | 'deleted_at'
        >
        Update: Partial<
          Pick<FolderRow, 'parent_id' | 'name' | 'color' | 'emoji' | 'deleted_at' | 'updated_by'>
        >
        Relationships: []
      }
      notes: {
        Row: NoteRow
        Insert: never
        Update: Partial<Pick<NoteRow, 'folder_id' | 'pinned' | 'deleted_at'>>
        Relationships: []
      }
      files: {
        Row: FileRow
        Insert: Insertable<
          FileRow,
          'space_id' | 'name' | 'kind' | 'mime' | 'size_bytes' | 'storage_path',
          'id' | 'folder_id' | 'duration_sec' | 'created_by' | 'deleted_at'
        >
        Update: Partial<Pick<FileRow, 'folder_id' | 'name' | 'deleted_at'>>
        Relationships: []
      }
      share_links: {
        Row: ShareLinkRow
        Insert: never
        Update: never
        Relationships: []
      }
      space_members: {
        Row: SpaceMemberRow
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      is_allowed_email: { Args: Record<PropertyKey, never>; Returns: boolean }
      my_spaces: { Args: Record<PropertyKey, never>; Returns: { id: string; role: SpaceRole }[] }
      join_by_token: { Args: { p_token: string; p_display_name?: string | null }; Returns: Json }
      save_note: { Args: { p_note: Json; p_base_version: number | null }; Returns: Json }
      set_link_enabled: {
        Args: { p_link_id: string; p_enabled: boolean; p_remove_members?: boolean }
        Returns: Json
      }
      regenerate_share_link: {
        Args: { p_link_id: string; p_remove_members?: boolean }
        Returns: Json
      }
      set_display_name: { Args: { p_space_id: string; p_name: string }; Returns: undefined }
      touch_presence: { Args: Record<PropertyKey, never>; Returns: undefined }
      /** {purged, skipped, paths}: paths are the Storage objects of the file rows it purged. */
      purge_items: { Args: { p_ids: string[] }; Returns: Json }
      /** The 30-day emptying of the caller's own trash, chosen by the server; as purge_items. */
      purge_expired: { Args: Record<PropertyKey, never>; Returns: Json }
      storage_usage: { Args: Record<PropertyKey, never>; Returns: number }
      ping: { Args: Record<PropertyKey, never>; Returns: string }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** Result of save_note. */
export type SaveNoteResult = {
  status: 'ok' | 'conflict' | 'gone'
  note: NoteRow
}

/** Result of join_by_token. */
export type JoinResult = {
  space_id: string
  role: SpaceRole
  name: string
  color: string | null
  emoji: string | null
}

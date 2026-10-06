import Dexie, { type EntityTable } from 'dexie'
import type { OutboxEntry } from '@/sync/types'
import type {
  FileRow,
  FolderRow,
  NoteRow,
  ProfileRow,
  SpaceMemberRow,
  SpaceRole,
  SpaceRow,
} from './database.types'

/** The caller's role in a space, as reported by my_spaces() on every pull. */
export interface SpaceAccess {
  space_id: string
  role: SpaceRole
}

export interface MetaEntry {
  key: string
  value: string
}

/**
 * The local database: the UI reads and writes only here. One database per account
 * (`biblenote-<user id>`) so accounts on the same browser never mix.
 * Mirrored tables keep the server column names; `members` mirrors `space_members`.
 */
export class BibleNoteDb extends Dexie {
  spaces!: EntityTable<SpaceRow, 'id'>
  folders!: EntityTable<FolderRow, 'id'>
  notes!: EntityTable<NoteRow, 'id'>
  files!: EntityTable<FileRow, 'id'>
  members!: EntityTable<SpaceMemberRow, 'id'>
  profiles!: EntityTable<ProfileRow, 'id'>
  spaceAccess!: EntityTable<SpaceAccess, 'space_id'>
  outbox!: EntityTable<OutboxEntry, 'seq'>
  meta!: EntityTable<MetaEntry, 'key'>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      spaces: 'id, owner_id, updated_at, deleted_at',
      folders: 'id, space_id, parent_id, updated_at, deleted_at',
      notes: 'id, space_id, folder_id, *tags, updated_at, deleted_at',
      files: 'id, space_id, folder_id, kind, updated_at, deleted_at',
      members: 'id, space_id, user_id',
      profiles: 'id',
      spaceAccess: 'space_id',
      outbox: '++seq, [table+row_id], status, space_id',
      meta: 'key',
    })
  }
}

export const dbNameFor = (userId: string): string => `biblenote-${userId}`

export function openDb(userId: string): BibleNoteDb {
  return new BibleNoteDb(dbNameFor(userId))
}

/** Wipes the account's local data. Used only by an explicit sign-out on this device. */
export async function deleteDb(userId: string): Promise<void> {
  await Dexie.delete(dbNameFor(userId))
}

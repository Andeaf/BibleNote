import type {
  FileKind,
  FileRow,
  FolderRow,
  NoteRow,
  SpaceRole,
  SpaceRow,
} from '@/lib/database.types'

/** Days an item stays in the trash before the automatic emptying (decided by the server). */
export const TRASH_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export type TrashKind = 'space' | 'folder' | 'note' | 'file'

export interface TrashItem {
  kind: TrashKind
  id: string
  name: string
  spaceId: string
  /** Where it was: the main folder and the folders above it (empty for a main folder). */
  path: string[]
  deletedAt: string
  /** The 30 days count from here: the server's trash time, the device's until it is synced. */
  expiresFrom: string
  fileKind?: FileKind
  role: SpaceRole | null
}

export interface TrashSource {
  spaces: SpaceRow[]
  folders: FolderRow[]
  notes: NoteRow[]
  files: FileRow[]
  roles: Map<string, SpaceRole>
}

/**
 * What the trash screen lists: the items whose parent is not in the trash too,
 * newest first. A folder stands for everything trashed with it, a main folder for its contents.
 */
export function collectTrash({ spaces, folders, notes, files, roles }: TrashSource): TrashItem[] {
  const spaceById = new Map(spaces.map((s) => [s.id, s]))
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const items: TrashItem[] = []

  const pathOf = (spaceId: string, folderId: string | null): string[] => {
    const names: string[] = []
    let current = folderId ? folderById.get(folderId) : undefined
    while (current) {
      names.unshift(current.name)
      current = current.parent_id ? folderById.get(current.parent_id) : undefined
    }
    return [spaceById.get(spaceId)?.name ?? '', ...names]
  }
  // The space is not in the trash and neither is the folder it sits in.
  const listed = (spaceId: string, folderId: string | null) => {
    const space = spaceById.get(spaceId)
    if (!space || space.deleted_at) return false
    return !folderId || !folderById.get(folderId)?.deleted_at
  }
  const role = (spaceId: string) => roles.get(spaceId) ?? null

  for (const space of spaces) {
    if (space.deleted_at && !space.purged_at) {
      items.push({
        kind: 'space',
        id: space.id,
        name: space.name,
        spaceId: space.id,
        path: [],
        deletedAt: space.deleted_at,
        expiresFrom: space.trashed_at ?? space.deleted_at,
        role: role(space.id),
      })
    }
  }
  for (const folder of folders) {
    if (!folder.deleted_at || folder.purged_at || !listed(folder.space_id, folder.parent_id))
      continue
    items.push({
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      spaceId: folder.space_id,
      path: pathOf(folder.space_id, folder.parent_id),
      deletedAt: folder.deleted_at,
      expiresFrom: folder.trashed_at ?? folder.deleted_at,
      role: role(folder.space_id),
    })
  }
  for (const note of notes) {
    if (!note.deleted_at || note.purged_at || !listed(note.space_id, note.folder_id)) continue
    items.push({
      kind: 'note',
      id: note.id,
      name: note.title,
      spaceId: note.space_id,
      path: pathOf(note.space_id, note.folder_id),
      deletedAt: note.deleted_at,
      expiresFrom: note.trashed_at ?? note.deleted_at,
      role: role(note.space_id),
    })
  }
  for (const file of files) {
    if (!file.deleted_at || file.purged_at || !listed(file.space_id, file.folder_id)) continue
    items.push({
      kind: 'file',
      id: file.id,
      name: file.name,
      spaceId: file.space_id,
      path: pathOf(file.space_id, file.folder_id),
      deletedAt: file.deleted_at,
      expiresFrom: file.trashed_at ?? file.deleted_at,
      fileKind: file.kind,
      role: role(file.space_id),
    })
  }
  return items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
}

/** Whole days left before the automatic emptying (0 when it is due). */
export function daysLeft(deletedAt: string, now: number): number {
  const end = Date.parse(deletedAt) + TRASH_DAYS * DAY_MS
  return Math.max(0, Math.ceil((end - now) / DAY_MS))
}

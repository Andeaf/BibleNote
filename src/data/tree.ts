import type { FolderRow } from '@/lib/database.types'

/** Ids of every folder below `folderId` (not including it). */
export function descendantIds(folders: readonly FolderRow[], folderId: string): string[] {
  const byParent = new Map<string | null, FolderRow[]>()
  for (const folder of folders) {
    const list = byParent.get(folder.parent_id) ?? []
    list.push(folder)
    byParent.set(folder.parent_id, list)
  }
  const out: string[] = []
  const stack = [folderId]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const child of byParent.get(current) ?? []) {
      out.push(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/** Folders from the space root down to `folderId` (inclusive), for breadcrumbs. */
export function pathTo(folders: readonly FolderRow[], folderId: string | null): FolderRow[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: FolderRow[] = []
  let current = folderId ? byId.get(folderId) : undefined
  let guard = 0
  while (current && guard++ < 200) {
    path.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return path
}

/** True when `targetId` is `folderId` itself or one of its descendants (a move there is a cycle). */
export function isSelfOrDescendant(
  folders: readonly FolderRow[],
  folderId: string,
  targetId: string | null,
): boolean {
  if (targetId === null) return false
  if (targetId === folderId) return true
  return descendantIds(folders, folderId).includes(targetId)
}

/** Live folders (not in the trash) of a space, direct children of `parentId`. */
export function childrenOf(folders: readonly FolderRow[], parentId: string | null): FolderRow[] {
  return folders.filter((f) => f.parent_id === parentId && !f.deleted_at)
}

export type SortMode = 'name' | 'date'

/** Notes of a list: pinned ones on top, then by title or by last change. */
export function sortNotes<T extends { title: string; pinned: boolean; updated_at: string }>(
  notes: readonly T[],
  mode: SortMode,
): T[] {
  const copy = [...notes]
  copy.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (mode === 'name') {
      return (a.title.trim() || '￿').localeCompare(b.title.trim() || '￿', 'ro', {
        sensitivity: 'base',
      })
    }
    return Date.parse(b.updated_at) - Date.parse(a.updated_at)
  })
  return copy
}

export function sortItems<T extends { name: string; updated_at: string }>(
  items: readonly T[],
  mode: SortMode,
): T[] {
  const copy = [...items]
  if (mode === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name, 'ro', { sensitivity: 'base' }))
  } else {
    copy.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
  }
  return copy
}

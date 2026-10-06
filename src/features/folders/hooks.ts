import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useSyncExternalStore } from 'react'
import type { SortMode } from '@/data/tree'
import type { FolderRow, SpaceRole, SpaceRow } from '@/lib/database.types'
import { useDb } from '@/sync/SyncContext'

export type SpaceWithRole = SpaceRow & { role: SpaceRole }

/** Live main folders (not in the trash) the account can reach, with its role in each. */
export function useSpaces(): SpaceWithRole[] | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [spaces, access] = await Promise.all([db.spaces.toArray(), db.spaceAccess.toArray()])
    const roles = new Map(access.map((a) => [a.space_id, a.role]))
    return spaces
      .filter((s) => !s.deleted_at && roles.has(s.id))
      .map((s) => ({ ...s, role: roles.get(s.id) as SpaceRole }))
  }, [db])
}

/** `undefined` while loading, `null` when the space is not available locally. */
export function useSpace(spaceId: string): SpaceWithRole | null | undefined {
  const db = useDb()
  return useLiveQuery(async () => {
    const [space, access] = await Promise.all([db.spaces.get(spaceId), db.spaceAccess.get(spaceId)])
    if (!space || !access) return null
    return { ...space, role: access.role }
  }, [db, spaceId])
}

/** Every folder row of a space, trashed ones included (tree helpers filter as needed). */
export function useSpaceFolders(spaceId: string): FolderRow[] | undefined {
  const db = useDb()
  return useLiveQuery(() => db.folders.where('space_id').equals(spaceId).toArray(), [db, spaceId])
}

export const canEditRole = (role: SpaceRole | undefined): boolean =>
  role === 'owner' || role === 'editor'

const SORT_KEY = 'bn-sort'
const sortListeners = new Set<() => void>()

function readSort(): SortMode {
  try {
    return localStorage.getItem(SORT_KEY) === 'date' ? 'date' : 'name'
  } catch {
    return 'name'
  }
}

/** Sort preference, remembered per device. */
export function useSortMode(): [SortMode, (mode: SortMode) => void] {
  const mode = useSyncExternalStore(
    (listener) => {
      sortListeners.add(listener)
      return () => sortListeners.delete(listener)
    },
    readSort,
    () => 'name' as SortMode,
  )
  const setMode = useCallback((next: SortMode) => {
    try {
      localStorage.setItem(SORT_KEY, next)
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    for (const listener of sortListeners) listener()
  }, [])
  return [mode, setMode]
}

const desktopQuery = '(min-width: 1024px)'

/** True from the `lg` breakpoint: sidebar layout and drag & drop instead of "Mută în…". */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const media = window.matchMedia(desktopQuery)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    () => window.matchMedia(desktopQuery).matches,
    () => false,
  )
}

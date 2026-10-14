import type { BibleNoteDb } from '@/lib/db'
import type { AnyRow, PurgeResult, SyncApi } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
/** A Storage object without any row is removed only once it is this old. */
export const ORPHAN_MIN_AGE_MS = 30 * DAY_MS
/** The owner's cleanup runs at most this often (and only after a pull of the session). */
export const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000
/** Objects whose rows are purged, still to be removed (a JSON array of paths in `meta`). */
export const PENDING_REMOVALS_KEY = 'pending_removals'
export const HOUSEKEEPING_AT_KEY = 'housekeeping_at'
const ROWS_PAGE = 500

export interface HousekeepingDeps {
  db: BibleNoteDb
  api: SyncApi
  /** The engine clock (ms): only paces the runs. Ages use the server's clock. */
  now: () => number
}

/** The file id of a path '{space_id}/{file_id}', or null for anything else. */
const fileIdOf = (path: string, spaceId: string): string | null => {
  const [space, id, ...rest] = path.split('/')
  return space === spaceId && id && rest.length === 0 ? id : null
}

async function pendingRemovals(db: BibleNoteDb): Promise<string[]> {
  const entry = await db.meta.get(PENDING_REMOVALS_KEY)
  if (!entry) return []
  try {
    const value = JSON.parse(entry.value) as unknown
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

/**
 * Removes Storage objects of purged rows. The paths are written down first, so a removal cut
 * short (offline, app closed) is finished by the next run instead of leaving them forever.
 */
export async function removePurgedObjects(
  { db, api }: Pick<HousekeepingDeps, 'db' | 'api'>,
  paths: string[],
): Promise<void> {
  const all = [...new Set([...(await pendingRemovals(db)), ...paths])]
  if (all.length === 0) return
  await db.meta.put({ key: PENDING_REMOVALS_KEY, value: JSON.stringify(all) })
  await api.removeObjects(all)
  await db.meta.delete(PENDING_REMOVALS_KEY)
}

/** Every file row of a space on the server, purged ones included (keyset pages). */
async function serverFileRows(api: SyncApi, spaceId: string): Promise<Map<string, AnyRow>> {
  const rows = new Map<string, AnyRow>()
  let after: { updated_at: string; id: string } | undefined
  for (;;) {
    const page = await api.pullPage('files', { spaceId, limit: ROWS_PAGE, after })
    for (const row of page) rows.set(row.id, row)
    if (page.length < ROWS_PAGE) return rows
    const last = page[page.length - 1] as AnyRow
    after = { updated_at: last.updated_at, id: last.id }
  }
}

/**
 * The orphan sweep of one space. It never trusts the local copy:
 * a row another device added, not pulled here yet, or a row still waiting in some outbox after
 * its object went up must never cost the file. So:
 * - the objects are listed first (all pages), then the space's file rows are read from the
 *   server, so a row inserted before that read is seen;
 * - an object whose row is purged goes (the row can never come back);
 * - an object without any row goes only when it is older than 30 days (server time), and only
 *   if a second read of those rows, right before removing, still finds none;
 * - objects of this device's own unsent uploads are never touched.
 * Returns the paths removed.
 */
export async function sweepOrphans(
  { db, api }: Pick<HousekeepingDeps, 'db' | 'api'>,
  spaceId: string,
  serverNow: number,
): Promise<string[]> {
  const objects = await api.listObjects(spaceId)
  if (objects.length === 0) return []
  const rows = await serverFileRows(api, spaceId)
  const mine = new Set(
    (await db.outbox.toArray()).filter((e) => e.op === 'upload').map((e) => e.row_id),
  )
  const purged: string[] = []
  const candidates = new Map<string, string>()
  for (const object of objects) {
    const id = fileIdOf(object.path, spaceId)
    if (!id || mine.has(id)) continue
    const row = rows.get(id)
    if (row?.purged_at) purged.push(object.path)
    else if (!row && serverNow - Date.parse(object.createdAt) > ORPHAN_MIN_AGE_MS) {
      candidates.set(id, object.path)
    }
  }
  if (candidates.size > 0) {
    // A row that arrived since the first read keeps its object.
    for (const row of await api.fetchByIds('files', [...candidates.keys()])) {
      if (!row.purged_at) candidates.delete(row.id)
    }
  }
  const remove = [...purged, ...candidates.values()]
  if (remove.length > 0) await api.removeObjects(remove)
  return remove
}

/**
 * The owner's cleanup after a pull: finish removals cut short, empty what the server says has
 * been in the trash for 30 days (purge_expired: never the device's own idea of it), then sweep
 * the orphans of every space owned. The caller runs it only after a successful pull of the
 * session and at most hourly.
 */
export async function runHousekeeping(
  deps: HousekeepingDeps,
  ownedSpaceIds: string[],
): Promise<{ expired: PurgeResult; orphans: string[] }> {
  const { db, api } = deps
  await removePurgedObjects(deps, [])
  const expired = await api.purgeExpired()
  await removePurgedObjects(deps, expired.paths)
  // Storage dates the objects with the server's clock: ages are measured against it, never
  // against the device's, which may be days off.
  const serverNow = Date.parse(await api.serverTime())
  const orphans: string[] = []
  for (const spaceId of ownedSpaceIds) {
    orphans.push(...(await sweepOrphans({ db, api }, spaceId, serverNow)))
  }
  await db.meta.put({ key: HOUSEKEEPING_AT_KEY, value: String(deps.now()) })
  return { expired, orphans }
}

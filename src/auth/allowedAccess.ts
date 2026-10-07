/**
 * "May this account create main folders?" (is_allowed_email). It never gates the app: any
 * signed-in account enters and sees its local data. The last answer from the server is kept per
 * account so it survives going offline; with no answer at all the value is `null` (unknown)
 * and the create button simply stays hidden.
 */

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type AllowedRpc = () => PromiseLike<{
  data: boolean | null
  error: { message: string } | null
}>

const cacheKey = (userId: string) => `bn-allowed-${userId}`

export function readCachedAllowed(store: KeyValueStore | null, userId: string): boolean | null {
  try {
    const value = store?.getItem(cacheKey(userId))
    return value === 'true' ? true : value === 'false' ? false : null
  } catch {
    return null
  }
}

export interface AllowedResult {
  allowed: boolean | null
  /** True when the value was just confirmed by the server (and cached). */
  fromServer: boolean
}

/** Asks the server; on any failure (offline, timeout, …) falls back to the cached answer. */
export async function resolveAllowed(
  userId: string,
  rpc: AllowedRpc,
  store: KeyValueStore | null,
): Promise<AllowedResult> {
  try {
    const { data, error } = await rpc()
    if (!error && typeof data === 'boolean') {
      try {
        store?.setItem(cacheKey(userId), String(data))
      } catch {
        /* storage unavailable: the value lasts for this session only */
      }
      return { allowed: data, fromServer: true }
    }
  } catch {
    /* network error: fall through to the cache */
  }
  return { allowed: readCachedAllowed(store, userId), fromServer: false }
}

export type FoldersScreen =
  /** There are main folders to show. */
  | 'list'
  /** No main folders, and this account may create them. */
  | 'empty_owner'
  /** The server said "not allowed" and my_spaces is known to be empty: "Nu ai acces încă". */
  | 'no_access'
  /** Nothing to show yet and not enough is known (offline, first start): a neutral hint. */
  | 'empty_unknown'

/**
 * What the Folders page shows. "Nu ai acces încă" needs both answers from the server:
 * allowed = false and an empty my_spaces (a completed pull). Offline it never appears.
 */
export function foldersScreen(input: {
  allowed: boolean | null
  spaceCount: number
  pulled: boolean
}): FoldersScreen {
  if (input.spaceCount > 0) return 'list'
  if (input.allowed === true) return 'empty_owner'
  if (input.allowed === false && input.pulled) return 'no_access'
  return 'empty_unknown'
}

/** localStorage, or null where it is unavailable (private mode, blocked storage). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

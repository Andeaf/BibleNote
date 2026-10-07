import { describe, expect, it } from 'vitest'
import {
  foldersScreen,
  readCachedAllowed,
  resolveAllowed,
  type AllowedRpc,
  type KeyValueStore,
} from './allowedAccess'

const USER = 'user-1'

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  data: Record<string, string>
} {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

const offline: AllowedRpc = () => Promise.reject(new TypeError('Failed to fetch'))
const offlineError: AllowedRpc = async () => ({
  data: null,
  error: { message: 'TypeError: Failed to fetch' },
})
const server =
  (allowed: boolean): AllowedRpc =>
  async () => ({ data: allowed, error: null })

describe('offline', () => {
  it('with local data, the folders are shown whatever is known about allowed', async () => {
    for (const cached of [undefined, 'true', 'false']) {
      const store = memoryStore(cached ? { [`bn-allowed-${USER}`]: cached } : {})
      for (const rpc of [offline, offlineError]) {
        const { allowed, fromServer } = await resolveAllowed(USER, rpc, store)
        expect(fromServer).toBe(false)
        expect(foldersScreen({ allowed, spaceCount: 2, pulled: false })).toBe('list')
      }
    }
  })

  it('at the first start after login, "Nu ai acces încă" does not appear', async () => {
    const store = memoryStore()
    const { allowed, fromServer } = await resolveAllowed(USER, offline, store)
    expect(allowed).toBeNull()
    expect(fromServer).toBe(false)
    expect(foldersScreen({ allowed, spaceCount: 0, pulled: false })).toBe('empty_unknown')
  })

  it('keeps the last known answer, and never shows "no access" before my_spaces is known', async () => {
    const store = memoryStore({ [`bn-allowed-${USER}`]: 'false' })
    const { allowed } = await resolveAllowed(USER, offline, store)
    expect(allowed).toBe(false)
    expect(foldersScreen({ allowed, spaceCount: 0, pulled: false })).toBe('empty_unknown')
  })
})

describe('online', () => {
  it('caches the server answer per account', async () => {
    const store = memoryStore()
    expect(await resolveAllowed(USER, server(true), store)).toEqual({
      allowed: true,
      fromServer: true,
    })
    expect(readCachedAllowed(store, USER)).toBe(true)
    expect(readCachedAllowed(store, 'user-2')).toBeNull()
  })

  it('shows "no access" only when the server said no and my_spaces is empty', () => {
    expect(foldersScreen({ allowed: false, spaceCount: 0, pulled: true })).toBe('no_access')
    expect(foldersScreen({ allowed: false, spaceCount: 1, pulled: true })).toBe('list')
    expect(foldersScreen({ allowed: true, spaceCount: 0, pulled: true })).toBe('empty_owner')
    expect(foldersScreen({ allowed: null, spaceCount: 0, pulled: true })).toBe('empty_unknown')
  })

  it('survives unavailable storage', async () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect((await resolveAllowed(USER, server(false), broken)).allowed).toBe(false)
    expect(await resolveAllowed(USER, offline, broken)).toEqual({
      allowed: null,
      fromServer: false,
    })
  })
})

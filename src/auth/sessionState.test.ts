import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from './allowedAccess'
import {
  decideAuth,
  readStoredSession,
  supabaseStorageKey,
  type StoredSession,
} from './sessionState'

const KEY = 'sb-abcdefghijklmnopqrst-auth-token'
const past = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)
const future = Math.floor(Date.now() / 1000) + 3600

const stored = (overrides: Partial<StoredSession> = {}): StoredSession => ({
  access_token: 'old-jwt',
  refresh_token: 'refresh-123',
  expires_at: past,
  user: { id: 'user-1', email: 'a@b.test' },
  ...overrides,
})

const live = {
  access_token: 'jwt',
  refresh_token: 'r',
  expires_at: future,
  user: { id: 'user-1' },
} as unknown as Session

const store = (raw: string | null): KeyValueStore => ({
  getItem: (key) => (key === KEY ? raw : null),
  setItem: () => undefined,
})

describe('decideAuth', () => {
  it('valid session: signed in, online', () => {
    const decision = decideAuth({ live, stored: stored({ expires_at: future }) })
    expect(decision).toEqual({ status: 'signed_in', session: live, offline: false })
  })

  it('expired access token with a refresh token, offline: signed in offline on the stored session', () => {
    // auth-js reports no session (the refresh failed for lack of network) but keeps storage.
    const decision = decideAuth({ live: null, stored: stored() })
    expect(decision.status).toBe('signed_in')
    if (decision.status !== 'signed_in') return
    expect(decision.offline).toBe(true)
    expect(decision.session.user.id).toBe('user-1')
  })

  it('refresh token rejected by the server: auth-js clears storage, so signed out', () => {
    expect(decideAuth({ live: null, stored: null })).toEqual({ status: 'signed_out' })
  })

  it('no session at all: signed out', () => {
    expect(decideAuth({ live: null, stored: null })).toEqual({ status: 'signed_out' })
    expect(decideAuth({ live: null, stored: stored({ refresh_token: '' }) })).toEqual({
      status: 'signed_out',
    })
    expect(decideAuth({ live: null, stored: stored({ user: null }) })).toEqual({
      status: 'signed_out',
    })
  })

  it('opens from the stored session before supabase-js answers: no spinner offline', () => {
    const decision = decideAuth({ live: undefined, stored: stored() })
    expect(decision.status).toBe('signed_in')
    // Without a stored session there is nothing to open: wait for the (local) initial state.
    expect(decideAuth({ live: undefined, stored: null })).toEqual({ status: 'loading' })
  })
})

describe('stored session', () => {
  it('uses the supabase-js storage key of the project', () => {
    expect(supabaseStorageKey('https://abcdefghijklmnopqrst.supabase.co')).toBe(KEY)
  })

  it('reads the stored JSON and tolerates garbage or blocked storage', () => {
    expect(readStoredSession(store(JSON.stringify(stored())), KEY)?.refresh_token).toBe(
      'refresh-123',
    )
    expect(readStoredSession(store('{not json'), KEY)).toBeNull()
    expect(readStoredSession(store(null), KEY)).toBeNull()
    expect(readStoredSession(null, KEY)).toBeNull()
    const blocked: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => undefined,
    }
    expect(readStoredSession(blocked, KEY)).toBeNull()
  })
})

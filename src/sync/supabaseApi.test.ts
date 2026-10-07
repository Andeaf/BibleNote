import { describe, expect, it } from 'vitest'
import { toApiError } from './supabaseApi'

describe('toApiError', () => {
  it('classifies expired sessions, timeouts and rate limits as retryable', () => {
    expect(toApiError({ message: 'JWT expired', code: 'PGRST301' }, 401).kind).toBe('auth')
    expect(toApiError({ message: 'JWT expired', code: 'PGRST303' }, 401).kind).toBe('auth')
    expect(toApiError({ message: 'Unauthorized' }, 401).kind).toBe('auth')
    expect(toApiError({ message: 'Request Timeout' }, 408).kind).toBe('server')
    expect(toApiError({ message: 'Too Many Requests' }, 429).kind).toBe('server')
    expect(toApiError({ message: 'Service Unavailable' }, 503).kind).toBe('server')
  })

  it('keeps the other classes', () => {
    expect(toApiError({ message: 'TypeError: Failed to fetch' }).kind).toBe('network')
    expect(toApiError({ message: 'fk', code: '23503' }, 409).kind).toBe('fk')
    expect(toApiError({ message: 'dup', code: '23505' }, 409).kind).toBe('unique')
    expect(toApiError({ message: 'rls', code: '42501' }, 403).kind).toBe('forbidden')
    expect(toApiError({ message: 'BN_FOLDER_DELETED', code: 'P0001' }, 400).kind).toBe('validation')
    expect(toApiError({ message: 'bad', code: 'PGRST100' }, 400).kind).toBe('unknown')
  })
})

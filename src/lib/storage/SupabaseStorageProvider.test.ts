import { describe, expect, it } from 'vitest'
import { toStorageApiError } from './SupabaseStorageProvider'

describe('toStorageApiError', () => {
  it('treats a taken path as "already exists" (the engine counts it as success)', () => {
    const current = { message: 'The resource already exists', status: 409, statusCode: '409' }
    const older = { message: 'The resource already exists', status: 400, statusCode: '409' }
    expect(toStorageApiError(current).kind).toBe('unique')
    expect(toStorageApiError(older).kind).toBe('unique')
  })

  it('retries network failures, expired tokens and server errors', () => {
    expect(toStorageApiError({ message: 'Failed to fetch' }).kind).toBe('network')
    expect(toStorageApiError({ message: 'Load failed' }).kind).toBe('network')
    const expired = {
      message: '"exp" claim timestamp check failed',
      status: 400,
      statusCode: '403',
    }
    expect(toStorageApiError(expired).kind).toBe('auth')
    expect(toStorageApiError({ message: 'jwt expired', status: 403 }).kind).toBe('auth')
    expect(toStorageApiError({ message: 'Bad Gateway', status: 502 }).kind).toBe('server')
    expect(toStorageApiError({ message: 'Too Many Requests', status: 429 }).kind).toBe('server')
  })

  it('fails at once on RLS denials and files over the limit', () => {
    const rls = { message: 'new row violates row-level security policy', status: 403 }
    expect(toStorageApiError(rls).kind).toBe('forbidden')
    const big = { message: 'The object exceeded the maximum allowed size', status: 413 }
    expect(toStorageApiError(big)).toMatchObject({
      kind: 'validation',
      message: 'BN_FILE_TOO_LARGE',
    })
  })
})

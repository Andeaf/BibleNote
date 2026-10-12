import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { Database } from '@/lib/database.types'
import { LIST_PAGE_SIZE, REMOVE_BATCH_SIZE } from './StorageProvider'
import { createSupabaseStorageProvider, toStorageApiError } from './SupabaseStorageProvider'

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

describe('listing and removing objects', () => {
  /** A storage-js stand-in: `list` pages through `items`, `remove` records its batches. */
  function fakeClient(items: { name: string; id: string | null; created_at: string | null }[]) {
    const lists: number[] = []
    const removes: string[][] = []
    const bucket = {
      async list(_prefix: string, options: { limit: number; offset: number }) {
        lists.push(options.offset)
        return { data: items.slice(options.offset, options.offset + options.limit), error: null }
      },
      async remove(paths: string[]) {
        removes.push(paths)
        return { data: [], error: null }
      },
    }
    const client = { storage: { from: () => bucket } } as unknown as SupabaseClient<Database>
    return { client, lists, removes }
  }

  it('reads every page and skips folder placeholders', async () => {
    const items = Array.from({ length: LIST_PAGE_SIZE * 2 + 3 }, (_, i) => ({
      name: `file-${String(i).padStart(5, '0')}`,
      id: i === 5 ? null : `id-${i}`,
      created_at: i === 5 ? null : '2026-01-01T00:00:00Z',
    }))
    const { client, lists } = fakeClient(items)
    const storage = createSupabaseStorageProvider(client, { url: 'https://x', key: 'k' })
    const objects = await storage.list('space-1')
    expect(lists).toEqual([0, LIST_PAGE_SIZE, LIST_PAGE_SIZE * 2])
    expect(objects).toHaveLength(items.length - 1)
    expect(objects[0]).toEqual({ path: 'space-1/file-00000', createdAt: '2026-01-01T00:00:00Z' })
  })

  it('removes in batches', async () => {
    const { client, removes } = fakeClient([])
    const storage = createSupabaseStorageProvider(client, { url: 'https://x', key: 'k' })
    await storage.remove(Array.from({ length: REMOVE_BATCH_SIZE + 1 }, (_, i) => `s/${i}`))
    expect(removes.map((batch) => batch.length)).toEqual([REMOVE_BATCH_SIZE, 1])
  })
})

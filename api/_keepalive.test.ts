// The underscore keeps Vercel from deploying this file as a function of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './keepalive.ts'

const SUPABASE_URL = 'https://example.supabase.co'
const KEY = 'sb_publishable_test'

describe('keepalive', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL + '/')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', KEY)
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    fetchMock.mockReset()
  })

  it('posts to rpc/ping with the publishable key in apikey only and answers ok', async () => {
    fetchMock.mockResolvedValue(new Response('"2026-10-15T07:00:00+00:00"', { status: 200 }))

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [target, init] = fetchMock.mock.calls[0]!
    expect(target).toBe(`${SUPABASE_URL}/rest/v1/rpc/ping`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ apikey: KEY, 'Content-Type': 'application/json' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('answers only "error" when Supabase refuses, without its details', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Invalid API key","hint":"secret detail"}', { status: 401 }),
    )

    const response = await GET()

    expect(response.status).toBe(502)
    expect(await response.text()).toBe('error')
  })

  it('answers "error" when the request fails or times out', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    const response = await GET()

    expect(response.status).toBe(502)
    expect(await response.text()).toBe('error')
  })

  it('answers "error" without a request when a variable is missing', async () => {
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('error')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

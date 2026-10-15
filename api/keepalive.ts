// Keep-alive for the free Supabase project, which pauses after 7 days without activity.
// Vercel Cron calls this once a day (vercel.json). `.github/workflows/keepalive.yml` stays as a
// backup: GitHub disables scheduled workflows of a public repository after 60 days without
// activity. It uses the two variables the app is built with, and answers only "ok" or "error":
// no detail from Supabase leaves the function (the reason goes to the Vercel log).

const TIMEOUT_MS = 10_000

function reply(body: 'ok' | 'error', status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(): Promise<Response> {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    console.error('keepalive: VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY is not set')
    return reply('error', 500)
  }
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/ping`, {
      method: 'POST',
      // The publishable key goes only in apikey: it is not a JWT.
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.ok) return reply('ok', 200)
    console.error(`keepalive: ping answered HTTP ${response.status}`)
  } catch (error) {
    console.error(`keepalive: ping failed (${error instanceof Error ? error.name : 'unknown'})`)
  }
  return reply('error', 502)
}

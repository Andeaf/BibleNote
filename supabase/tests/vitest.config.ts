import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Runs only with `npm run test:rls`, against a real Supabase project.
// Reads SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from .env.test.local.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    env: loadEnv('test', process.cwd(), ''),
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})

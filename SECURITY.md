# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting instead: **Security → Report a vulnerability** on this repository.
Reports are read within a few days; there is no bug bounty.

## What is in scope

- The web app in `src/` (authentication flow, offline storage, sync engine, sharing links).
- The database schema, row-level security policies, triggers and RPC functions in
  `supabase/migrations/`, and the Storage and Realtime policies defined there.
- The security regression test in `supabase/tests/rls.test.ts`.

## Security model in short

- The browser only ever holds the Supabase project URL and the **publishable** key. That key is
  public by design: every read and write is authorised server-side by row-level security, Storage
  policies and `security definer` functions. The secret (service role) key is never shipped and
  is used only locally to run the RLS test.
- Access to a space is decided by a single SQL helper, `has_space_access(space_id, min_role)`,
  shared by the table policies, the Storage policies and the Realtime channel policies.
- Share links are random tokens; joining through a link creates an anonymous session scoped to
  that space with the role the link grants.

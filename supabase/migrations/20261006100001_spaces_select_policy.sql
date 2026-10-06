-- Fix (found by the RLS test on the real project): the SELECT policy on spaces relied only on
-- has_space_access(), whose owner branch is a subquery on spaces itself. Postgres also checks
-- the SELECT policy on rows returned by INSERT … RETURNING (which PostgREST uses for
-- .insert().select()), and inside that same command the subquery cannot see the new row yet,
-- so the owner's own insert failed with 42501 "new row violates row-level security policy".
-- Checking owner_id directly first fixes it; members still go through has_space_access().

drop policy "spaces: read" on public.spaces;

create policy "spaces: read" on public.spaces
  for select to authenticated
  using (owner_id = auth.uid() or public.has_space_access(id, 'viewer'));

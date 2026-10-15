-- The app is open to anyone with an account (David's decision, 2026-10-15): every signed-in
-- account may create its own main folders (spaces), not only the emails in allowed_emails.
-- People who came in only through a share link (anonymous sign-in, no email) still may not,
-- and still see only what their link gave them.
--
-- The function keeps its name: the policy "spaces: insert by allowed owners" and every
-- installed copy of the app call it. It no longer reads allowed_emails, so it no longer needs
-- security definer. The table stays (unused), so the list can come back with a new migration if
-- the app is ever misused. CREATE OR REPLACE keeps the existing grants (authenticated only).

create or replace function public.is_allowed_email()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and coalesce(auth.jwt() ->> 'email', '') <> ''
$$;

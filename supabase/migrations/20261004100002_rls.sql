-- BibleNote: access helpers, row level security and column grants. See docs/PLAN.md §3.1–3.2.
-- Roles: viewer (1) < editor (2) < owner (3). The owner is spaces.owner_id; members come from
-- space_members. Members lose access while the space is in the trash; the owner never does
-- (tombstones must keep syncing).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.role_rank(r text)
returns integer
language sql
immutable
as $$
  select case r when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end
$$;

-- The single source of truth for access, used by RLS, Storage and Realtime policies alike.
create or replace function public.has_space_access(p_space_id uuid, p_min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.spaces s
      where s.id = p_space_id
        and s.owner_id = auth.uid()
    )
    or exists (
      select 1
      from public.spaces s
      join public.space_members m on m.space_id = s.id
      where s.id = p_space_id
        and m.user_id = auth.uid()
        and s.deleted_at is null
        and s.purged_at is null
        and public.role_rank(m.role) >= public.role_rank(p_min_role)
    )
$$;

create or replace function public.is_space_owner(p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.spaces s where s.id = p_space_id and s.owner_id = auth.uid()
  )
$$;

-- Only non-anonymous users whose email is in allowed_emails may create spaces.
create or replace function public.is_allowed_email()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and exists (
      select 1
      from public.allowed_emails a
      where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
$$;

-- ---------------------------------------------------------------------------
-- Table privileges: nothing for anon; notes are updated only through save_note except for the
-- metadata columns (folder_id, pinned, deleted_at), which the client updates directly.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.notes from authenticated;
grant update (folder_id, pinned, deleted_at) on public.notes to authenticated;
revoke insert, update, delete on public.share_links from authenticated;
revoke insert, update on public.space_members from authenticated;
revoke all on public.allowed_emails from authenticated;
revoke delete on public.spaces, public.folders, public.files, public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.spaces enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.files enable row level security;
alter table public.share_links enable row level security;
alter table public.space_members enable row level security;

-- profiles: your own row, plus the profile of the owner of any space you can access
-- (needed for "modified by X").
create policy "profiles: read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.spaces s
      where s.owner_id = profiles.id and public.has_space_access(s.id, 'viewer')
    )
  );

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- allowed_emails: no policies at all; only is_allowed_email() reads it.

-- spaces
create policy "spaces: read" on public.spaces
  for select to authenticated
  using (public.has_space_access(id, 'viewer'));

create policy "spaces: insert by allowed owners" on public.spaces
  for insert to authenticated
  with check (owner_id = auth.uid() and public.is_allowed_email());

create policy "spaces: update by owner" on public.spaces
  for update to authenticated
  using (owner_id = auth.uid() and purged_at is null)
  with check (owner_id = auth.uid());

-- folders
create policy "folders: read" on public.folders
  for select to authenticated
  using (public.has_space_access(space_id, 'viewer'));

create policy "folders: insert by editors" on public.folders
  for insert to authenticated
  with check (public.has_space_access(space_id, 'editor') and created_by = auth.uid());

create policy "folders: update by editors" on public.folders
  for update to authenticated
  using (public.has_space_access(space_id, 'editor') and purged_at is null)
  with check (public.has_space_access(space_id, 'editor') and updated_by = auth.uid());

-- notes: inserts and content updates only through save_note; metadata updates by editors.
create policy "notes: read" on public.notes
  for select to authenticated
  using (public.has_space_access(space_id, 'viewer'));

create policy "notes: update metadata by editors" on public.notes
  for update to authenticated
  using (public.has_space_access(space_id, 'editor') and purged_at is null)
  with check (public.has_space_access(space_id, 'editor'));

-- files
create policy "files: read" on public.files
  for select to authenticated
  using (public.has_space_access(space_id, 'viewer'));

create policy "files: insert by editors" on public.files
  for insert to authenticated
  with check (public.has_space_access(space_id, 'editor') and created_by = auth.uid());

create policy "files: update by editors" on public.files
  for update to authenticated
  using (public.has_space_access(space_id, 'editor') and purged_at is null)
  with check (public.has_space_access(space_id, 'editor'));

-- share_links: tokens are visible to the owner only; changes go through RPCs.
create policy "share_links: read by owner" on public.share_links
  for select to authenticated
  using (public.is_space_owner(space_id));

-- space_members: everyone in the space sees the names; only the owner removes people;
-- joining and name changes go through RPCs.
create policy "space_members: read" on public.space_members
  for select to authenticated
  using (public.has_space_access(space_id, 'viewer'));

create policy "space_members: delete by owner" on public.space_members
  for delete to authenticated
  using (public.is_space_owner(space_id));

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.has_space_access(uuid, text) from public, anon;
revoke execute on function public.is_space_owner(uuid) from public, anon;
revoke execute on function public.is_allowed_email() from public, anon;
grant execute on function public.has_space_access(uuid, text) to authenticated;
grant execute on function public.is_space_owner(uuid) to authenticated;
grant execute on function public.is_allowed_email() to authenticated;

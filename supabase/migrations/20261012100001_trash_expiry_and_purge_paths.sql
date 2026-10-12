-- Phase 6 (docs/PLAN.md §5.8, rev. 15): the automatic 30-day emptying is decided by the server,
-- by its own clock, and permanent deletion tells the client which Storage objects it made
-- obsolete.
--
-- 1. trashed_at: when the server saw the item go into the trash. deleted_at stays the client's
--    stamp (it groups what was trashed together, for restoring), but it comes from the device:
--    a phone whose date is months behind, or an editor writing an old date on purpose, must not
--    shorten the 30 days. Set only by the trigger below; clients have no grant on it.
-- 2. purge_items(ids) is unchanged in what it purges and who may call it, but its answer now
--    also lists `paths`: the storage_path of every file row it purged, directly or through a
--    folder or a space. The client deletes exactly those objects (rows keep storage_path).
-- 3. purge_expired() replaces the client's choice of "expired" items: a device whose local copy
--    is out of date could otherwise send an item that was restored and deleted again recently.
--    The server picks, in the caller's own spaces, what has had trashed_at for more than 30 days.

alter table public.spaces add column trashed_at timestamptz;
alter table public.folders add column trashed_at timestamptz;
alter table public.notes add column trashed_at timestamptz;
alter table public.files add column trashed_at timestamptz;

-- What is in the trash already gets a fresh 30 days: its deleted_at came from a device.
-- (Before the trigger exists, which would keep the old, empty value.)
update public.spaces set trashed_at = now() where deleted_at is not null and purged_at is null;
update public.folders set trashed_at = now() where deleted_at is not null and purged_at is null;
update public.notes set trashed_at = now() where deleted_at is not null and purged_at is null;
update public.files set trashed_at = now() where deleted_at is not null and purged_at is null;

create or replace function public.set_trashed_at()
returns trigger
language plpgsql
as $$
begin
  -- The service role (the RLS test, maintenance) may set it directly; nobody else can.
  if current_user = 'service_role' and tg_op = 'UPDATE'
     and new.trashed_at is distinct from old.trashed_at then
    return new;
  end if;
  if new.deleted_at is null then
    new.trashed_at := null;
  elsif tg_op = 'INSERT' or old.deleted_at is null
        or new.deleted_at is distinct from old.deleted_at then
    new.trashed_at := now();
  else
    new.trashed_at := old.trashed_at;
  end if;
  return new;
end
$$;

create trigger spaces_set_trashed_at before insert or update on public.spaces
  for each row execute function public.set_trashed_at();
create trigger folders_set_trashed_at before insert or update on public.folders
  for each row execute function public.set_trashed_at();
create trigger notes_set_trashed_at before insert or update on public.notes
  for each row execute function public.set_trashed_at();
create trigger files_set_trashed_at before insert or update on public.files
  for each row execute function public.set_trashed_at();

create or replace function public.purge_items(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_space uuid;
  v_path text;
  v_more text[];
  v_folder_ids uuid[];
  v_count integer := 0;
  v_skipped uuid[] := '{}';
  v_paths text[] := '{}';
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  foreach v_id in array coalesce(p_ids, '{}') loop
    -- note
    select space_id into v_space from public.notes
    where id = v_id and deleted_at is not null and purged_at is null;
    if found then
      if not public.is_space_owner(v_space) then
        v_skipped := v_skipped || v_id; continue;
      end if;
      update public.notes
      set title = '', content = '{}'::jsonb, content_text = '', tags = '{}', purged_at = now()
      where id = v_id;
      v_count := v_count + 1; continue;
    end if;

    -- file
    select space_id into v_space from public.files
    where id = v_id and deleted_at is not null and purged_at is null;
    if found then
      if not public.is_space_owner(v_space) then
        v_skipped := v_skipped || v_id; continue;
      end if;
      update public.files set name = '', purged_at = now() where id = v_id
      returning storage_path into v_path;
      v_paths := v_paths || v_path;
      v_count := v_count + 1; continue;
    end if;

    -- folder: whole subtree
    select space_id into v_space from public.folders
    where id = v_id and deleted_at is not null and purged_at is null;
    if found then
      if not public.is_space_owner(v_space) then
        v_skipped := v_skipped || v_id; continue;
      end if;
      with recursive sub as (
        select f.id from public.folders f where f.id = v_id
        union all
        select f.id from public.folders f join sub on f.parent_id = sub.id
      )
      select array_agg(sub.id) into v_folder_ids from sub;
      update public.notes
      set title = '', content = '{}'::jsonb, content_text = '', tags = '{}',
          deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where folder_id = any (v_folder_ids) and purged_at is null;
      with purged as (
        update public.files
        set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
        where folder_id = any (v_folder_ids) and purged_at is null
        returning storage_path
      )
      select coalesce(array_agg(storage_path), '{}') into v_more from purged;
      v_paths := v_paths || v_more;
      update public.folders
      set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where id = any (v_folder_ids) and purged_at is null;
      v_count := v_count + 1; continue;
    end if;

    -- space: everything inside, members removed, links disabled
    select id into v_space from public.spaces
    where id = v_id and deleted_at is not null and purged_at is null and owner_id = uid;
    if found then
      update public.notes
      set title = '', content = '{}'::jsonb, content_text = '', tags = '{}',
          deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where space_id = v_id and purged_at is null;
      with purged as (
        update public.files
        set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
        where space_id = v_id and purged_at is null
        returning storage_path
      )
      select coalesce(array_agg(storage_path), '{}') into v_more from purged;
      v_paths := v_paths || v_more;
      update public.folders
      set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where space_id = v_id and purged_at is null;
      update public.spaces set name = '', purged_at = now() where id = v_id;
      delete from public.space_members where space_id = v_id;
      update public.share_links set enabled = false where space_id = v_id;
      v_count := v_count + 1; continue;
    end if;

    v_skipped := v_skipped || v_id;
  end loop;

  return jsonb_build_object('purged', v_count, 'skipped', to_jsonb(v_skipped),
                            'paths', to_jsonb(v_paths));
end
$$;

-- ---------------------------------------------------------------------------
-- purge_expired(): the automatic emptying of the trash. Everything in the caller's own spaces
-- whose trashed_at is more than 30 days old (server clock) is purged through purge_items.
-- Something restored and deleted again has a new trashed_at, so it waits its own 30 days.
-- Items of other people's spaces are never touched. Same answer as purge_items.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_cutoff timestamptz := now() - interval '30 days';
  v_ids uuid[];
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select coalesce(array_agg(x.id order by x.rank), '{}') into v_ids from (
    select s.id, 0 as rank from public.spaces s
    where s.owner_id = uid and s.purged_at is null and s.trashed_at < v_cutoff
    union all
    select f.id, 1 from public.folders f join public.spaces s on s.id = f.space_id
    where s.owner_id = uid and f.purged_at is null and f.trashed_at < v_cutoff
    union all
    select n.id, 2 from public.notes n join public.spaces s on s.id = n.space_id
    where s.owner_id = uid and n.purged_at is null and n.trashed_at < v_cutoff
    union all
    select fi.id, 2 from public.files fi join public.spaces s on s.id = fi.space_id
    where s.owner_id = uid and fi.purged_at is null and fi.trashed_at < v_cutoff
  ) x;
  return public.purge_items(v_ids);
end
$$;

revoke execute on function public.purge_expired() from public, anon;
grant execute on function public.purge_expired() to authenticated;

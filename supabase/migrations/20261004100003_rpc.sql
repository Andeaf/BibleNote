-- BibleNote: RPCs. See docs/PLAN.md §3.3.
-- Rule (rev. 2): access is checked against the space of the row that already exists in the
-- database, never against the space_id sent in the payload.
-- Error conventions: 42501 (HTTP 403) = not allowed; P0001 (HTTP 400) = invalid input.
-- Messages are stable codes (BN_*) that the client maps to Romanian text.

-- ---------------------------------------------------------------------------
-- my_spaces(): every space the caller can reach, with their role. Used by every pull.
-- Owners also get their trashed spaces (for the trash screen); members do not.
-- ---------------------------------------------------------------------------
create or replace function public.my_spaces()
returns table (id uuid, role text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, 'owner'::text as role
  from public.spaces s
  where s.owner_id = auth.uid() and s.purged_at is null
  union all
  select m.space_id, m.role
  from public.space_members m
  join public.spaces s on s.id = m.space_id
  where m.user_id = auth.uid() and s.deleted_at is null and s.purged_at is null
$$;

-- ---------------------------------------------------------------------------
-- join_by_token(token, display_name): enter a space through a share link.
-- The role never goes down: opening a viewer link after an editor link keeps editor.
-- ---------------------------------------------------------------------------
create or replace function public.join_by_token(p_token text, p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  l public.share_links%rowtype;
  s public.spaces%rowtype;
  m public.space_members%rowtype;
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  select * into l from public.share_links where token = p_token and enabled;
  if not found then
    raise exception 'BN_INVALID_LINK' using errcode = 'P0001';
  end if;

  select * into s from public.spaces
  where id = l.space_id and deleted_at is null and purged_at is null;
  if not found then
    raise exception 'BN_INVALID_LINK' using errcode = 'P0001';
  end if;

  if s.owner_id = uid then
    return jsonb_build_object('space_id', s.id, 'role', 'owner', 'name', s.name,
                              'color', s.color, 'emoji', s.emoji);
  end if;

  insert into public.space_members (space_id, user_id, role, display_name, link_id, last_seen_at)
  values (s.id, uid, l.role, v_name, l.id, now())
  on conflict (space_id, user_id) do update
    set role = case
                 when public.role_rank(excluded.role) > public.role_rank(space_members.role)
                 then excluded.role else space_members.role
               end,
        link_id = case
                    when public.role_rank(excluded.role) > public.role_rank(space_members.role)
                    then excluded.link_id else space_members.link_id
                  end,
        display_name = coalesce(excluded.display_name, space_members.display_name),
        last_seen_at = now()
  returning * into m;

  return jsonb_build_object('space_id', s.id, 'role', m.role, 'name', s.name,
                            'color', s.color, 'emoji', s.emoji);
end
$$;

-- ---------------------------------------------------------------------------
-- save_note(note, base_version): insert, or update title/content/content_text/tags only when
-- the server version is still base_version. Returns {status: ok | conflict | gone, note}.
-- Metadata (folder_id, pinned, deleted_at) is never touched on update (rev. 2).
-- ---------------------------------------------------------------------------
create or replace function public.save_note(p_note jsonb, p_base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_space uuid;
  v_tags text[];
  existing public.notes%rowtype;
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  v_id := (p_note ->> 'id')::uuid;
  if v_id is null then
    raise exception 'BN_INVALID_NOTE' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(x.v), '{}'::text[]) into v_tags
  from jsonb_array_elements_text(coalesce(p_note -> 'tags', '[]'::jsonb)) as x(v);

  select * into existing from public.notes where id = v_id for update;

  if not found then
    v_space := (p_note ->> 'space_id')::uuid;
    if v_space is null or not public.has_space_access(v_space, 'editor') then
      raise exception 'BN_FORBIDDEN' using errcode = '42501';
    end if;
    insert into public.notes (id, space_id, folder_id, title, content, content_text, tags, pinned,
                              version, created_by, updated_by, deleted_at)
    values (
      v_id,
      v_space,
      (p_note ->> 'folder_id')::uuid,
      coalesce(p_note ->> 'title', ''),
      coalesce(p_note -> 'content', '{}'::jsonb),
      coalesce(p_note ->> 'content_text', ''),
      v_tags,
      coalesce((p_note ->> 'pinned')::boolean, false),
      1,
      uid,
      uid,
      (p_note ->> 'deleted_at')::timestamptz
    )
    returning * into existing;
    return jsonb_build_object('status', 'ok', 'note', to_jsonb(existing));
  end if;

  if existing.purged_at is not null then
    return jsonb_build_object('status', 'gone', 'note', to_jsonb(existing));
  end if;
  if not public.has_space_access(existing.space_id, 'editor') then
    raise exception 'BN_FORBIDDEN' using errcode = '42501';
  end if;
  if existing.version <> p_base_version then
    return jsonb_build_object('status', 'conflict', 'note', to_jsonb(existing));
  end if;

  update public.notes
  set title = coalesce(p_note ->> 'title', ''),
      content = coalesce(p_note -> 'content', '{}'::jsonb),
      content_text = coalesce(p_note ->> 'content_text', ''),
      tags = v_tags,
      version = version + 1,
      updated_by = uid
  where id = v_id
  returning * into existing;

  return jsonb_build_object('status', 'ok', 'note', to_jsonb(existing));
end
$$;

-- ---------------------------------------------------------------------------
-- Share link management (owner only). Both return the link row.
-- ---------------------------------------------------------------------------
create or replace function public.set_link_enabled(p_link_id uuid, p_enabled boolean,
                                                   p_remove_members boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.share_links%rowtype;
begin
  select * into l from public.share_links where id = p_link_id;
  if not found or not public.is_space_owner(l.space_id) then
    raise exception 'BN_FORBIDDEN' using errcode = '42501';
  end if;
  update public.share_links set enabled = p_enabled where id = p_link_id returning * into l;
  if p_remove_members then
    delete from public.space_members where link_id = p_link_id;
  end if;
  return to_jsonb(l);
end
$$;

create or replace function public.regenerate_share_link(p_link_id uuid,
                                                        p_remove_members boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.share_links%rowtype;
begin
  select * into l from public.share_links where id = p_link_id;
  if not found or not public.is_space_owner(l.space_id) then
    raise exception 'BN_FORBIDDEN' using errcode = '42501';
  end if;
  if p_remove_members then
    delete from public.space_members where link_id = p_link_id;
  end if;
  update public.share_links set token = public.new_share_token() where id = p_link_id
  returning * into l;
  return to_jsonb(l);
end
$$;

-- ---------------------------------------------------------------------------
-- Names and presence.
-- ---------------------------------------------------------------------------
create or replace function public.set_display_name(p_space_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if public.is_space_owner(p_space_id) then
    update public.profiles set display_name = v_name where id = uid;
    return;
  end if;
  update public.space_members set display_name = v_name
  where space_id = p_space_id and user_id = uid;
  if not found then
    raise exception 'BN_FORBIDDEN' using errcode = '42501';
  end if;
end
$$;

create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.space_members set last_seen_at = now() where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- purge_items(ids): permanent deletion by the owner of each item's space. Rows stay as
-- tombstones (content scrubbed, purged_at set) so every device learns about it on pull.
-- Only items already in the trash can be purged; folders and spaces cascade.
-- The client deletes the Storage objects of the affected files before calling this.
-- Returns {purged: <count>, skipped: [ids not purged]}.
-- ---------------------------------------------------------------------------
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
  v_folder_ids uuid[];
  v_count integer := 0;
  v_skipped uuid[] := '{}';
begin
  if uid is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  foreach v_id in array p_ids loop
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
      update public.files set name = '', purged_at = now() where id = v_id;
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
      update public.files
      set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where folder_id = any (v_folder_ids) and purged_at is null;
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
      update public.files
      set name = '', deleted_at = coalesce(deleted_at, now()), purged_at = now()
      where space_id = v_id and purged_at is null;
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

  return jsonb_build_object('purged', v_count, 'skipped', to_jsonb(v_skipped));
end
$$;

-- ---------------------------------------------------------------------------
-- storage_usage(): bytes used in the files bucket (the free plan quota is per project).
-- ---------------------------------------------------------------------------
create or replace function public.storage_usage()
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  if auth.uid() is null then
    raise exception 'BN_NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0) into v
  from storage.objects o
  where o.bucket_id = 'files';
  return v;
end
$$;

-- ---------------------------------------------------------------------------
-- ping(): keep-alive target for the GitHub Actions workflow (anon key).
-- ---------------------------------------------------------------------------
create or replace function public.ping()
returns timestamptz
language sql
stable
as $$
  select now()
$$;

-- ---------------------------------------------------------------------------
-- Privileges: every RPC for signed-in users only, ping also for anon.
-- ---------------------------------------------------------------------------
revoke execute on function public.my_spaces() from public, anon;
revoke execute on function public.join_by_token(text, text) from public, anon;
revoke execute on function public.save_note(jsonb, integer) from public, anon;
revoke execute on function public.set_link_enabled(uuid, boolean, boolean) from public, anon;
revoke execute on function public.regenerate_share_link(uuid, boolean) from public, anon;
revoke execute on function public.set_display_name(uuid, text) from public, anon;
revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.purge_items(uuid[]) from public, anon;
revoke execute on function public.storage_usage() from public, anon;
revoke execute on function public.new_share_token() from public, anon, authenticated;

grant execute on function public.my_spaces() to authenticated;
grant execute on function public.join_by_token(text, text) to authenticated;
grant execute on function public.save_note(jsonb, integer) to authenticated;
grant execute on function public.set_link_enabled(uuid, boolean, boolean) to authenticated;
grant execute on function public.regenerate_share_link(uuid, boolean) to authenticated;
grant execute on function public.set_display_name(uuid, text) to authenticated;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.purge_items(uuid[]) to authenticated;
grant execute on function public.storage_usage() to authenticated;
grant execute on function public.ping() to anon, authenticated;

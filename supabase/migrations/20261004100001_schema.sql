-- BibleNote: tables, triggers and indexes. See docs/PLAN.md §2.
-- Conventions: ids are client-generated uuids; created_at/updated_at are always set by the
-- server; deleted_at = trash; purged_at = permanently deleted (row kept as a tombstone for sync).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Emails allowed to create main folders (spaces). Never readable from the client.
create table public.allowed_emails (
  email text primary key
);

-- A space is a main folder: the unit of sharing.
create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text,
  emoji text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  parent_id uuid references public.folders (id) on delete cascade,
  name text not null,
  color text,
  emoji text,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete cascade,
  title text not null default '',
  content jsonb not null default '{}'::jsonb,
  content_text text not null default '',
  tags text[] not null default '{}',
  pinned boolean not null default false,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('audio', 'image', 'document')),
  mime text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null,
  duration_sec real,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  purged_at timestamptz
);

-- Exactly one viewer link and one editor link per space, created by trigger.
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  token text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, role)
);

-- People who entered a space through a link. The owner is spaces.owner_id, not a member row.
create table public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  display_name text,
  link_id uuid references public.share_links (id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Indexes (pull is paged on (space_id, updated_at, id))
-- ---------------------------------------------------------------------------

create index spaces_owner_idx on public.spaces (owner_id);
create index folders_space_updated_idx on public.folders (space_id, updated_at, id);
create index folders_parent_idx on public.folders (parent_id);
create index notes_space_updated_idx on public.notes (space_id, updated_at, id);
create index notes_folder_idx on public.notes (folder_id);
create index files_space_updated_idx on public.files (space_id, updated_at, id);
create index files_folder_idx on public.files (folder_id);
create index space_members_user_idx on public.space_members (user_id);
create index space_members_link_idx on public.space_members (link_id);

-- ---------------------------------------------------------------------------
-- Timestamps: the server owns created_at and updated_at.
-- ---------------------------------------------------------------------------

create or replace function public.set_timestamps()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger profiles_set_timestamps before insert or update on public.profiles
  for each row execute function public.set_timestamps();
create trigger spaces_set_timestamps before insert or update on public.spaces
  for each row execute function public.set_timestamps();
create trigger folders_set_timestamps before insert or update on public.folders
  for each row execute function public.set_timestamps();
create trigger notes_set_timestamps before insert or update on public.notes
  for each row execute function public.set_timestamps();
create trigger files_set_timestamps before insert or update on public.files
  for each row execute function public.set_timestamps();
create trigger share_links_set_timestamps before insert or update on public.share_links
  for each row execute function public.set_timestamps();
create trigger space_members_set_timestamps before insert or update on public.space_members
  for each row execute function public.set_timestamps();

-- ---------------------------------------------------------------------------
-- Profiles are created for every auth user (Google, email+password, anonymous).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'name',
        split_part(coalesce(new.email, ''), '@', 1)
      ),
      ''
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Share links: 256-bit random tokens, two per space, created with the space.
-- ---------------------------------------------------------------------------

create or replace function public.new_share_token()
returns text
language sql
volatile
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

create or replace function public.create_share_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.share_links (space_id, role, token)
  values (new.id, 'viewer', public.new_share_token()),
         (new.id, 'editor', public.new_share_token());
  return new;
end
$$;

create trigger spaces_create_share_links after insert on public.spaces
  for each row execute function public.create_share_links();

-- ---------------------------------------------------------------------------
-- Integrity rules enforced in the database (docs/PLAN.md §2, rev. 2 and rev. 3):
--   * space_id never changes on folders, notes, files;
--   * folder_id / parent_id must point to a folder of the same space that is neither in the
--     trash nor purged (checked on insert and whenever the value changes);
--   * folders cannot form cycles;
--   * files.storage_path is exactly '{space_id}/{id}'.
-- Validation errors use errcode P0001 (HTTP 400): the client marks the change as failed.
-- ---------------------------------------------------------------------------

create or replace function public.protect_space_id()
returns trigger
language plpgsql
as $$
begin
  if new.space_id is distinct from old.space_id then
    raise exception 'BN_SPACE_ID_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger folders_protect_space_id before update on public.folders
  for each row execute function public.protect_space_id();
create trigger notes_protect_space_id before update on public.notes
  for each row execute function public.protect_space_id();
create trigger files_protect_space_id before update on public.files
  for each row execute function public.protect_space_id();

create or replace function public.assert_folder_usable(p_folder_id uuid, p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select space_id, deleted_at, purged_at into f from public.folders where id = p_folder_id;
  if not found then
    raise exception 'BN_FOLDER_NOT_IN_SPACE' using errcode = 'P0001';
  end if;
  if f.space_id <> p_space_id then
    raise exception 'BN_FOLDER_NOT_IN_SPACE' using errcode = 'P0001';
  end if;
  if f.deleted_at is not null or f.purged_at is not null then
    raise exception 'BN_FOLDER_DELETED' using errcode = 'P0001';
  end if;
end
$$;

create or replace function public.validate_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cur uuid;
  depth integer := 0;
begin
  if new.parent_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'BN_FOLDER_CYCLE' using errcode = 'P0001';
  end if;
  perform public.assert_folder_usable(new.parent_id, new.space_id);
  cur := new.parent_id;
  while cur is not null loop
    if cur = new.id then
      raise exception 'BN_FOLDER_CYCLE' using errcode = 'P0001';
    end if;
    select parent_id into cur from public.folders where id = cur;
    depth := depth + 1;
    if depth > 100 then
      raise exception 'BN_FOLDER_TOO_DEEP' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end
$$;

create trigger folders_validate before insert or update on public.folders
  for each row execute function public.validate_folder();

create or replace function public.validate_item_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.folder_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.folder_id is not distinct from old.folder_id then
    return new;
  end if;
  perform public.assert_folder_usable(new.folder_id, new.space_id);
  return new;
end
$$;

create trigger notes_validate_folder before insert or update on public.notes
  for each row execute function public.validate_item_folder();
create trigger files_validate_folder before insert or update on public.files
  for each row execute function public.validate_item_folder();

create or replace function public.validate_storage_path()
returns trigger
language plpgsql
as $$
begin
  if new.storage_path <> new.space_id::text || '/' || new.id::text then
    raise exception 'BN_BAD_STORAGE_PATH' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger files_validate_storage_path before insert or update on public.files
  for each row execute function public.validate_storage_path();

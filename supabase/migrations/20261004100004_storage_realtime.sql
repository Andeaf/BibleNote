-- BibleNote: Storage bucket + policies and Realtime channel policies. See docs/PLAN.md §3.4–3.5.

-- ---------------------------------------------------------------------------
-- Storage: private bucket `files`, 50 MB per object (the free plan limit), objects stored at
-- '{space_id}/{file_id}'. Access follows has_space_access on the first path segment.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- '{uuid}/{uuid}' -> the space id; anything else -> null (and therefore no access).
create or replace function public.storage_space_id(p_name text)
returns uuid
language sql
immutable
as $$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end
$$;

create policy "files bucket: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'files'
         and public.has_space_access(public.storage_space_id(name), 'viewer'));

create policy "files bucket: upload by editors" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'files'
              and public.has_space_access(public.storage_space_id(name), 'editor'));

create policy "files bucket: delete by owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'files'
         and public.has_space_access(public.storage_space_id(name), 'owner'));

-- ---------------------------------------------------------------------------
-- Realtime: one private channel per space, topic 'space:<space_id>'.
-- Receiving (broadcast + presence) and tracking presence: viewer and up.
-- Sending broadcast ("something changed, pull now"): editor and up.
-- The dashboard setting "Allow public access" must be off (docs/SETUP.md).
-- ---------------------------------------------------------------------------

create or replace function public.realtime_topic_space_id()
returns uuid
language plpgsql
stable
as $$
declare
  t text := realtime.topic();
  rest text;
begin
  if t is null or t not like 'space:%' then
    return null;
  end if;
  rest := substring(t from 7);
  if rest !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return rest::uuid;
end
$$;

create policy "space channel: receive" on realtime.messages
  for select to authenticated
  using (public.has_space_access(public.realtime_topic_space_id(), 'viewer'));

create policy "space channel: presence" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'presence'
              and public.has_space_access(public.realtime_topic_space_id(), 'viewer'));

create policy "space channel: broadcast by editors" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast'
              and public.has_space_access(public.realtime_topic_space_id(), 'editor'));

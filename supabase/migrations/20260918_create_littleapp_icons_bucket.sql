insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('littleapp-icons', 'littleapp-icons', true, 2097152, array['image/png'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "LittleApp icon insert" on storage.objects;
create policy "LittleApp icon insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'littleapp-icons'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "LittleApp icon update" on storage.objects;
create policy "LittleApp icon update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'littleapp-icons'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'littleapp-icons'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "LittleApp icon delete" on storage.objects;
create policy "LittleApp icon delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'littleapp-icons'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

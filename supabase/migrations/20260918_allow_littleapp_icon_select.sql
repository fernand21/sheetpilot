drop policy if exists "LittleApp icon select" on storage.objects;
create policy "LittleApp icon select"
on storage.objects for select
to authenticated
using (
  bucket_id = 'littleapp-icons'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

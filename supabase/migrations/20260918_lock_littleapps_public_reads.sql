drop policy if exists "Published LittleApps can be read" on public.littleapps;
revoke select on table public.littleapps from anon;

notify pgrst, 'reload schema';

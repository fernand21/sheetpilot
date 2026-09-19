grant select on table public.littleapps to anon;
grant select, insert, update, delete on table public.littleapps to authenticated;
grant all privileges on table public.littleapps to service_role;

notify pgrst, 'reload schema';

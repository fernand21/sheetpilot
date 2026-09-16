-- Ejecuta este script en Supabase: SQL Editor > New query.
-- Cada usuario solo puede ver y modificar sus propios proyectos.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  spreadsheet_id text,
  sheet_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Una hoja sólo puede estar conectada una vez por propietario.
create unique index if not exists projects_user_spreadsheet_unique
on public.projects(user_id, spreadsheet_id)
where spreadsheet_id is not null;

-- La tabla se consulta desde la Data API con el rol autenticado.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;

create policy "Users can see their own projects"
on public.projects for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own projects"
on public.projects for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own projects"
on public.projects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own projects"
on public.projects for delete to authenticated
using ((select auth.uid()) = user_id);

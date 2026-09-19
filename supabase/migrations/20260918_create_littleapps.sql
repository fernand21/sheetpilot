create table if not exists public.littleapps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  api_id text not null references public.api_endpoints(api_id) on delete cascade,
  name text not null,
  slug text not null,
  sheet text,
  config jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint littleapps_slug_format check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'
    or slug ~ '^[a-z0-9]{1,64}$'
  ),
  constraint littleapps_api_unique unique (api_id),
  constraint littleapps_slug_unique unique (slug)
);

alter table public.littleapps enable row level security;

create policy "Users can see their own LittleApps"
on public.littleapps for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Published LittleApps can be read"
on public.littleapps for select
to anon, authenticated
using (published = true);

create policy "Users can create their own LittleApps"
on public.littleapps for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own LittleApps"
on public.littleapps for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own LittleApps"
on public.littleapps for delete
to authenticated
using ((select auth.uid()) = user_id);

create index littleapps_user_id_idx on public.littleapps(user_id);
create index littleapps_project_id_idx on public.littleapps(project_id);
create index littleapps_published_idx on public.littleapps(published) where published = true;

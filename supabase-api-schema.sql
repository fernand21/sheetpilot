-- Registro de APIs públicas de LittleAPI.
-- Ejecutar en Supabase SQL Editor después de supabase-schema.sql.
-- La clave se verifica con SHA-256 y, para poder mostrarla al propietario,
-- se guarda además cifrada únicamente por la Edge Function.
create table if not exists public.api_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  api_id text not null unique check (api_id ~ '^[A-Za-z0-9_-]{12,64}$'),
  name text not null check (char_length(name) between 1 and 80),
  resource_type text not null default 'sheet' check (resource_type in ('sheet', 'drive')),
  spreadsheet_id text,
  default_sheet text,
  drive_file_id text,
  api_key_hash text not null unique,
  api_key_prefix text not null,
  api_key_ciphertext text,
  public_read boolean not null default true,
  permissions jsonb not null default '{"read": true, "search": true, "create": true, "update": true, "delete": true}'::jsonb,
  enabled boolean not null default true,
  cache_ttl integer not null default 60 check (cache_ttl between 0 and 3600),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_source_check check (
    (resource_type = 'sheet' and spreadsheet_id is not null and drive_file_id is null)
    or (resource_type = 'drive' and drive_file_id is not null and spreadsheet_id is null)
  )
);

alter table public.api_endpoints enable row level security;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.api_endpoints to authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.api_endpoints to service_role;

create index if not exists api_endpoints_user_id_idx on public.api_endpoints(user_id);
create index if not exists api_endpoints_project_id_idx on public.api_endpoints(project_id);
create index if not exists api_endpoints_api_id_idx on public.api_endpoints(api_id);
alter table public.api_endpoints add column if not exists cache_ttl integer not null default 60;
alter table public.api_endpoints add column if not exists api_key_ciphertext text;
alter table public.api_endpoints drop constraint if exists api_endpoints_cache_ttl_check;
alter table public.api_endpoints add constraint api_endpoints_cache_ttl_check check (cache_ttl between 0 and 3600);

-- Catálogo mínimo que puede consultar la Edge Function con la clave pública.
-- Nunca contiene la clave de API ni tokens de Google.
create table if not exists public.api_public_catalog (
  api_id text primary key references public.api_endpoints(api_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  resource_type text not null check (resource_type in ('sheet', 'drive')),
  spreadsheet_id text,
  default_sheet text,
  drive_file_id text,
  public_read boolean not null default true,
  permissions jsonb not null default '{"read": true, "search": true, "create": true, "update": true, "delete": true}'::jsonb,
  enabled boolean not null default true,
  cache_ttl integer not null default 60 check (cache_ttl between 0 and 3600),
  created_at timestamptz not null default now(),
  constraint public_catalog_source_check check (
    (resource_type = 'sheet' and spreadsheet_id is not null and drive_file_id is null)
    or (resource_type = 'drive' and drive_file_id is not null and spreadsheet_id is null)
  )
);

alter table public.api_public_catalog enable row level security;
create index if not exists api_public_catalog_user_id_idx on public.api_public_catalog(user_id);
alter table public.api_public_catalog add column if not exists cache_ttl integer not null default 60;
alter table public.api_public_catalog drop constraint if exists api_public_catalog_cache_ttl_check;
alter table public.api_public_catalog add constraint api_public_catalog_cache_ttl_check check (cache_ttl between 0 and 3600);
grant select on table public.api_public_catalog to anon, authenticated;
grant insert, update, delete on table public.api_public_catalog to authenticated;
grant select, insert, update, delete on table public.api_public_catalog to service_role;

drop policy if exists "Public APIs can be read" on public.api_public_catalog;
create policy "Public APIs can be read"
on public.api_public_catalog for select to anon, authenticated
using (enabled = true and public_read = true);

drop policy if exists "Users can create their API catalog entry" on public.api_public_catalog;
create policy "Users can create their API catalog entry"
on public.api_public_catalog for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their API catalog entry" on public.api_public_catalog;
create policy "Users can update their API catalog entry"
on public.api_public_catalog for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their API catalog entry" on public.api_public_catalog;
create policy "Users can delete their API catalog entry"
on public.api_public_catalog for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can see their own APIs" on public.api_endpoints;
create policy "Users can see their own APIs"
on public.api_endpoints for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own APIs" on public.api_endpoints;
create policy "Users can create their own APIs"
on public.api_endpoints for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own APIs" on public.api_endpoints;
create policy "Users can update their own APIs"
on public.api_endpoints for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own APIs" on public.api_endpoints;
create policy "Users can delete their own APIs"
on public.api_endpoints for delete to authenticated
using ((select auth.uid()) = user_id);

-- Refresh tokens de Google cifrados por la Edge Function con AES-GCM.
-- No se concede acceso a anon ni authenticated; sólo la función con service key.
create table if not exists public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token_ciphertext text not null,
  scopes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_connections enable row level security;
revoke all on table public.google_connections from anon, authenticated;
revoke all on table public.google_connections from public;
grant select, insert, update, delete on table public.google_connections to service_role;
drop policy if exists "No client access to Google connections" on public.google_connections;
create policy "No client access to Google connections"
on public.google_connections for all to anon, authenticated
using (false)
with check (false);

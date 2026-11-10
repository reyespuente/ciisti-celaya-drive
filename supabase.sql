-- Ejecutar una vez en SQL Editor del proyecto de demostración.
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid,
  name text not null check (char_length(name) between 1 and 150),
  kind text not null check (kind in ('file','folder')),
  object_key text,
  size bigint not null default 0 check (size between 0 and 10485760),
  mime text not null default 'application/octet-stream',
  starred boolean not null default false,
  trashed boolean not null default false,
  created_at timestamptz not null default now(),
  unique(id, owner_id),
  foreign key (parent_id,owner_id) references public.entries(id,owner_id),
  check ((kind='folder' and object_key is null and size=0) or
         (kind='file' and object_key like owner_id::text || '/%'))
);
create index entries_owner_parent on public.entries(owner_id,parent_id);
alter table public.entries enable row level security;
revoke all on public.entries from anon;
grant select,insert,update,delete on public.entries to authenticated;
create policy own_entries on public.entries for all to authenticated
using ((select auth.uid())=owner_id)
with check ((select auth.uid())=owner_id);
-- Las contraseñas y sesiones pertenecen a Supabase Auth. No se guardan aquí.

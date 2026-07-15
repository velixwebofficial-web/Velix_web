-- ============================================================================
-- VELIX WEB SOLUTIONS — SUPABASE SCHEMA
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query)
-- against a fresh project. Safe to re-run (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- PROFILES  (role-based access on top of Supabase Auth)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'editor' check (role in ('admin', 'editor')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user is created.
-- First user created gets 'admin'; everyone after defaults to 'editor'
-- (promote manually in the table editor: update role = 'admin').
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (
    new.id,
    new.email,
    case when (select count(*) from public.profiles) = 0 then 'admin' else 'editor' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- PROJECTS
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text default '',
  short_description text default '',
  full_description text default '',
  category text default '',
  client text default '',
  location text default '',
  completion_date date,
  featured boolean not null default false,
  published boolean not null default false,
  cover_image text default '',
  gallery jsonb not null default '[]'::jsonb,       -- array of storage URLs
  technologies jsonb not null default '[]'::jsonb,  -- array of strings
  services jsonb not null default '[]'::jsonb,
  website_url text default '',
  overview text default '',
  challenge text default '',
  solution text default '',
  results jsonb not null default '[]'::jsonb,
  seo_title text default '',
  seo_description text default '',
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists projects_published_idx on public.projects (published) where deleted_at is null;
create index if not exists projects_featured_idx on public.projects (featured) where deleted_at is null;
create index if not exists projects_category_idx on public.projects (category);
create index if not exists projects_slug_idx on public.projects (slug);
create index if not exists projects_sort_idx on public.projects (sort_order desc);

-- ----------------------------------------------------------------------------
-- NEWS
-- ----------------------------------------------------------------------------
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text default '',
  content text default '',
  category text default '',
  author text default '',
  cover_image text default '',
  video_url text default '',
  published boolean not null default false,
  seo_title text default '',
  seo_description text default '',
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists news_published_idx on public.news (published) where deleted_at is null;
create index if not exists news_slug_idx on public.news (slug);
create index if not exists news_created_idx on public.news (created_at desc);

-- ----------------------------------------------------------------------------
-- MEDIA  (metadata for files stored in the `media` Storage bucket)
-- ----------------------------------------------------------------------------
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_url text not null,
  storage_path text not null,
  mime_type text default '',
  size bigint default 0,
  width int,
  height int,
  folder text default '',
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists media_folder_idx on public.media (folder);
create index if not exists media_uploaded_idx on public.media (uploaded_at desc);

-- ----------------------------------------------------------------------------
-- SETTINGS  (single row, id fixed to 1)
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1,
  site_name text default 'VELIX Web Solutions',
  logo text default '',
  favicon text default '',
  phone text default '',
  email text default '',
  address text default '',
  social_links jsonb not null default '{}'::jsonb,
  seo_defaults jsonb not null default '{}'::jsonb,
  hero_video_url text default '',
  hero_poster text default '',
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- LEADS  (CRM — kept alongside the tables the brief specified, since the
-- site's chat widget / contact forms depend on it and it must not remain
-- in localStorage either)
-- ----------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text default '',
  email text default '',
  company text default '',
  project_details text default '',
  budget text default '',
  timeline text default '',
  source text default 'Website Form',
  session_id text,
  conversation_id text,
  status text not null default 'New',
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_idx on public.leads (created_at desc);

-- ----------------------------------------------------------------------------
-- CONVERSATIONS  (chat widget transcripts)
-- ----------------------------------------------------------------------------
create table if not exists public.conversations (
  id text primary key,
  messages jsonb not null default '[]'::jsonb,
  session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ACTIVITY LOG  (admin dashboard feed)
-- ----------------------------------------------------------------------------
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  icon text default 'dot',
  actor uuid references public.profiles(id),
  at timestamptz not null default now()
);

create index if not exists activity_at_idx on public.activity_log (at desc);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists news_set_updated_at on public.news;
create trigger news_set_updated_at before update on public.news
  for each row execute function public.set_updated_at();

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.projects enable row level security;
alter table public.news enable row level security;
alter table public.media enable row level security;
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.activity_log enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'editor')
  );
$$;

-- Public (anon) can read only published, non-deleted rows.
drop policy if exists "public read published projects" on public.projects;
create policy "public read published projects" on public.projects
  for select using (published = true and deleted_at is null);

drop policy if exists "staff full access projects" on public.projects;
create policy "staff full access projects" on public.projects
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "public read published news" on public.news;
create policy "public read published news" on public.news
  for select using (published = true and deleted_at is null);

drop policy if exists "staff full access news" on public.news;
create policy "staff full access news" on public.news
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "public read settings" on public.settings;
create policy "public read settings" on public.settings
  for select using (true);

drop policy if exists "staff write settings" on public.settings;
create policy "staff write settings" on public.settings
  for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "staff manage media" on public.media;
create policy "staff manage media" on public.media
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "public read media" on public.media;
create policy "public read media" on public.media
  for select using (true);

drop policy if exists "self read profile" on public.profiles;
create policy "self read profile" on public.profiles
  for select using (auth.uid() = id or public.is_staff());
drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Leads: anyone can INSERT (public lead-capture forms), only staff can read/manage.
drop policy if exists "anyone can submit lead" on public.leads;
create policy "anyone can submit lead" on public.leads
  for insert with check (true);
drop policy if exists "staff manage leads" on public.leads;
create policy "staff manage leads" on public.leads
  for select using (public.is_staff());
drop policy if exists "staff update leads" on public.leads;
create policy "staff update leads" on public.leads
  for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists "staff delete leads" on public.leads;
create policy "staff delete leads" on public.leads
  for delete using (public.is_staff());

-- Conversations: written by the (unauthenticated) chat widget, read by staff.
drop policy if exists "anyone can upsert own conversation" on public.conversations;
create policy "anyone can upsert own conversation" on public.conversations
  for insert with check (true);
drop policy if exists "anyone can update own conversation" on public.conversations;
create policy "anyone can update own conversation" on public.conversations
  for update using (true) with check (true);
drop policy if exists "staff read conversations" on public.conversations;
create policy "staff read conversations" on public.conversations
  for select using (public.is_staff());

drop policy if exists "staff read activity" on public.activity_log;
create policy "staff read activity" on public.activity_log
  for select using (public.is_staff());
drop policy if exists "staff write activity" on public.activity_log;
create policy "staff write activity" on public.activity_log
  for insert with check (public.is_staff());

-- ============================================================================
-- STORAGE — public "media" bucket, staff-only writes
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "public read media bucket" on storage.objects;
create policy "public read media bucket" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "staff upload media bucket" on storage.objects;
create policy "staff upload media bucket" on storage.objects
  for insert with check (bucket_id = 'media' and public.is_staff());

drop policy if exists "staff update media bucket" on storage.objects;
create policy "staff update media bucket" on storage.objects
  for update using (bucket_id = 'media' and public.is_staff());

drop policy if exists "staff delete media bucket" on storage.objects;
create policy "staff delete media bucket" on storage.objects
  for delete using (bucket_id = 'media' and public.is_staff());

-- ============================================================================
-- REALTIME — broadcast changes on these tables to subscribed clients
-- ============================================================================
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.news;

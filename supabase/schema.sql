-- Hazel AI — Complete Supabase Persistence & Memory Schema
-- Run this once in your Supabase Dashboard -> SQL Editor.
-- Safe to re-run (idempotent).

-- 1. Per-user app preferences, theme, and active chat pointer
create table if not exists public.hazel_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light',
  active_session_id text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Chat folders / categories
create table if not exists public.hazel_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  color text not null default 'blue',
  sort_order integer not null default 0,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);

-- 3. Conversations & full message history (including thoughts, sources, widgets)
create table if not exists public.hazel_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  category_id text,
  messages jsonb not null default '[]'::jsonb,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);

create index if not exists idx_hazel_sessions_user_updated
  on public.hazel_sessions (user_id, updated_at desc);

-- 4. Scheduled timers & time-based reminders
create table if not exists public.hazel_reminders (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  session_id text,
  label text not null,
  duration_seconds integer not null,
  created_at bigint not null,
  target_time bigint not null,
  is_reminder boolean not null default false,
  reminder_note text,
  primary key (user_id, id)
);

-- 5. Hazel long-term memories saved across conversations & live voice
create table if not exists public.hazel_memories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  content text not null,
  category text not null default 'general',
  source text not null default 'assistant',
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);

create index if not exists idx_hazel_memories_user_updated
  on public.hazel_memories (user_id, updated_at desc);

-- 6. Optional admin console state (used when SUPABASE_SERVICE_ROLE_KEY is configured)
create table if not exists public.hazel_admin_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Enable Row Level Security across all tables
alter table public.hazel_user_state enable row level security;
alter table public.hazel_categories enable row level security;
alter table public.hazel_sessions enable row level security;
alter table public.hazel_reminders enable row level security;
alter table public.hazel_memories enable row level security;
alter table public.hazel_admin_state enable row level security;

-- Drop/recreate policies so script is safely re-runnable
drop policy if exists "hazel_user_state_owner_all" on public.hazel_user_state;
create policy "hazel_user_state_owner_all"
  on public.hazel_user_state
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "hazel_categories_owner_all" on public.hazel_categories;
create policy "hazel_categories_owner_all"
  on public.hazel_categories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "hazel_sessions_owner_all" on public.hazel_sessions;
create policy "hazel_sessions_owner_all"
  on public.hazel_sessions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "hazel_reminders_owner_all" on public.hazel_reminders;
create policy "hazel_reminders_owner_all"
  on public.hazel_reminders
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "hazel_memories_owner_all" on public.hazel_memories;
create policy "hazel_memories_owner_all"
  on public.hazel_memories
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

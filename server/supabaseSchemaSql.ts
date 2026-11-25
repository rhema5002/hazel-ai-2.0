import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_FILE = path.resolve(__dirname, '..', 'supabase', 'schema.sql');

const FALLBACK_SQL = `-- Hazel AI — Supabase Schema
create table if not exists public.hazel_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light',
  active_session_id text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.hazel_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null,
  color text not null default 'blue',
  sort_order integer not null default 0,
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (user_id, id)
);
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
create table if not exists public.hazel_admin_state (
  id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);`;

let cachedSql: string | null = null;

export function getSupabaseSchemaSql(): string {
  if (cachedSql) return cachedSql;
  try {
    if (fs.existsSync(SCHEMA_FILE)) {
      cachedSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
      return cachedSql;
    }
  } catch {
    // Fall back to inline copy
  }
  cachedSql = FALLBACK_SQL;
  return cachedSql;
}

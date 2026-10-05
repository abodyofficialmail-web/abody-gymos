-- 食事パーソナル専用アカウントのメール確認コードと、1回予約チケット

create table if not exists public.meal_personal_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  display_name text,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists meal_personal_login_codes_email_idx
  on public.meal_personal_login_codes (email, created_at desc);

alter table public.members
  add column if not exists meal_session_tickets integer not null default 0;

create table if not exists public.meal_session_ticket_grants (
  stripe_session_id text primary key,
  member_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now()
);

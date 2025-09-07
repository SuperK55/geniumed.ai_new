create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  city text,
  specialty text,
  reason text,
  whatsapp text,
  preferred_channel text default 'call',
  timezone text default 'America/Sao_Paulo',
  next_retry_at timestamptz,
  status text not null default 'new',
  created_at timestamptz default now()
);

create table if not exists call_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  direction text not null default 'outbound',
  attempt_no int not null default 1,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  outcome text,
  retell_call_id text,
  transcript text,
  meta jsonb default '{}'::jsonb
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  expected_amount numeric(10,2),
  currency text default 'BRL',
  status text not null default 'pending',
  receipt_url text,
  ocr_amount numeric(10,2),
  ocr_raw jsonb,
  checked_at timestamptz
);

create table if not exists doctors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty text not null,
  credential text,
  price_first numeric(10,2),
  duration_minutes int default 30,
  gcal_email text not null,
  city text,
  languages text[],
  tags text[],
  bio text
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  doctor_id uuid references doctors(id),
  start_at timestamptz,
  end_at timestamptz,
  timezone text default 'America/Sao_Paulo',
  status text default 'pending',
  gcal_event_id text
);

create index if not exists idx_leads_status on leads(status);
create index if not exists idx_call_attempts_lead on call_attempts(lead_id);
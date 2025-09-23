-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS call_attempts CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS doctors CASCADE;
DROP TABLE IF EXISTS specialties CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE specialties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_desc TEXT,
  synonyms TEXT[],
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Users table for authentication
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin-business' CHECK (role IN ('admin', 'admin-business')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION trg_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER touch_users_updated_at
BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TRIGGER touch_specialties_updated_at
BEFORE UPDATE ON specialties FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  specialty TEXT,
  languages TEXT[],
  city TEXT,
  telemedicine BOOLEAN DEFAULT false,
  price_first NUMERIC(10,2),
  price_return NUMERIC(10,2),
  description TEXT,
  tags TEXT[],
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  specialty_id UUID REFERENCES specialties(id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TRIGGER touch_doctors_updated_at
BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  city TEXT,
  specialty TEXT,
  reason TEXT,
  whatsapp TEXT,
  preferred_channel TEXT DEFAULT 'call',
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  next_retry_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL DEFAULT 'outbound',
  attempt_no INT NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  outcome TEXT,
  retell_call_id TEXT,
  transcript TEXT,
  meta JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  expected_amount NUMERIC(10,2),
  currency TEXT DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'pending',
  receipt_url TEXT,
  ocr_amount NUMERIC(10,2),
  ocr_raw JSONB,
  checked_at TIMESTAMPTZ
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  status TEXT DEFAULT 'pending',
  gcal_event_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_specialties_name ON specialties (lower(name));
CREATE INDEX IF NOT EXISTS idx_specialties_tags ON specialties USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_specialties_syn  ON specialties USING GIN (synonyms);
CREATE INDEX IF NOT EXISTS idx_doctors_active   ON doctors (is_active);
CREATE INDEX IF NOT EXISTS idx_doctors_city     ON doctors (lower(city));
CREATE INDEX IF NOT EXISTS idx_doctors_tags     ON doctors USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_doctors_lang     ON doctors USING GIN (languages);
CREATE INDEX IF NOT EXISTS idx_doctors_spec_id  ON doctors (specialty_id);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_active     ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_retry ON leads(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON call_attempts(lead_id);

-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS doctor_agents CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
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

-- Users table - Business Owners/Administrators
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'owner' CHECK (role IN ('admin', 'owner', 'manager', 'staff')),
  
  -- Contact information
  phone_number TEXT, -- Phone number for outbound calls
  
  -- Simplified profile fields
  specialty TEXT, -- Medical specialty (e.g., "Cardiology", "Neurology")
  
  -- Social proof
  social_proof_enabled BOOLEAN DEFAULT false, -- Toggle to include a realistic success case
  social_proof_text TEXT, -- One concise story that matches the service
  
  -- Agent selection preferences
  default_agent_id UUID, -- Default agent for this owner's leads
  
  -- System fields
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

-- Doctors table - Medical professionals managed by business owners (NO agent fields)
CREATE TABLE doctors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE, -- Which business owner manages this doctor
  
  -- Doctor identification
  name TEXT NOT NULL,
  email TEXT,
  phone_number TEXT,
  
  -- Professional details
  specialty TEXT NOT NULL,
  bio TEXT,
  languages TEXT[] DEFAULT ARRAY['Português'],
  
  -- Consultation details
  consultation_price NUMERIC(10,2),
  return_consultation_price NUMERIC(10,2),
  consultation_duration INTEGER DEFAULT 90, -- minutes
  telemedicine_available BOOLEAN DEFAULT false,
  
  -- Availability
  working_hours JSONB DEFAULT '{}'::jsonb, -- {"monday": {"enabled": true, "timeSlots": [{"id": "1", "start": "09:00", "end": "17:00"}]}, ...}
  date_specific_availability JSONB DEFAULT '[]'::jsonb, -- [{"date": "2024-01-15", "type": "unavailable", "reason": "Holiday"}, ...]
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  
  -- Contact and location
  office_address TEXT,
  city TEXT,
  state TEXT,
  
  -- Professional tags and specializations
  tags TEXT[],
  
  -- Google Calendar integration
  google_calendar_id TEXT, -- Google Calendar ID
  google_refresh_token TEXT, -- Encrypted OAuth2 refresh token
  google_access_token TEXT, -- Temporary access token (optional, can be regenerated)
  google_token_expires_at TIMESTAMPTZ, -- When the access token expires
  calendar_sync_enabled BOOLEAN DEFAULT false, -- Whether calendar sync is enabled
  last_calendar_sync TIMESTAMPTZ, -- Last successful calendar sync timestamp
  
  -- System fields
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Agents table - Business-level AI agents (owned by business owners)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE, -- Which business owner owns this agent
  
  -- Agent identification
  agent_name TEXT NOT NULL, -- Custom agent name for conversations (primary identifier)
  
  -- Conversation control fields
  agent_role TEXT, -- Role description (e.g., "Medical Assistant", "Receptionist")
  service_description TEXT, -- Description of services offered
  assistant_name TEXT, -- Name of the assistant (e.g., "Clara", "Maria")
  
  -- Consultation / Service configuration
  return_policy_days INTEGER DEFAULT 30, -- Number of days for a follow-up included (e.g., 30)
  reimbursement_invoice_enabled BOOLEAN DEFAULT false, -- If enabled, we inform the user invoice is available for insurance claims
  payment_methods JSONB DEFAULT '{"credit_card_installments": 4, "pix_enabled": true}'::jsonb, -- Payment methods configuration
  confirmation_channel TEXT DEFAULT 'whatsapp' CHECK (confirmation_channel IN ('whatsapp', 'sms', 'email')), -- Choose where confirmations are sent
  
  -- Script components
  script JSONB DEFAULT '{}'::jsonb, -- Contains greeting, service_description, availability
  
  -- Retell AI configuration
  retell_agent_id TEXT UNIQUE, -- Retell AI agent ID
  conversation_flow_id TEXT, -- Retell conversation flow ID
  
  -- Agent settings
  language TEXT DEFAULT 'pt-BR',
  voice_id TEXT DEFAULT '11labs-Kate',
  ambient_sound TEXT DEFAULT 'coffee-shop',
  sent_paymentlink BOOLEAN DEFAULT false, -- Whether to automatically send payment links after consultation booking
  apply_discount_consultancy_pix BOOLEAN DEFAULT false, -- Whether to apply discount to consultancy pricing for PIX payments
  discount_percentage_pix INTEGER DEFAULT 0, -- Discount percentage for PIX payments (0-100)
  
  -- Custom variables for this agent
  custom_variables JSONB DEFAULT '{}'::jsonb,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_published BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER touch_users_updated_at
BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TRIGGER touch_specialties_updated_at
BEFORE UPDATE ON specialties FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TRIGGER touch_doctors_updated_at
BEFORE UPDATE ON doctors FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

CREATE TRIGGER touch_agents_updated_at
BEFORE UPDATE ON agents FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

-- Leads table - Updated for owner-controlled agent selection
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id), -- Which business owner this lead belongs to
  
  -- Lead information
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  city TEXT,
  specialty TEXT, -- Requested specialty
  reason TEXT,
  urgency_level INTEGER DEFAULT 1, -- 1-5 scale
  
  -- Communication preferences
  whatsapp TEXT,
  preferred_channel TEXT DEFAULT 'call',
  preferred_language TEXT DEFAULT 'Português',
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  
  -- Assignment and routing
  assigned_doctor_id UUID REFERENCES doctors(id), -- Which doctor this lead is assigned to
  assigned_agent_id UUID REFERENCES agents(id), -- Which agent will handle this lead (owner-selected)
  agent_variables JSONB DEFAULT '{}'::jsonb, -- Dynamic variables for the agent
  
  -- Lead status and timing
  status TEXT NOT NULL DEFAULT 'new',
  next_retry_at TIMESTAMPTZ,
  max_attempts INTEGER DEFAULT 3,
  priority INTEGER DEFAULT 1, -- 1-5 scale
  
  -- Source tracking
  source TEXT, -- 'website', 'referral', 'advertisement', etc.
  campaign TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  
  -- Additional data
  notes TEXT,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Call attempts table - Updated with doctor and owner tracking
CREATE TABLE call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id),
  agent_id UUID REFERENCES agents(id),
  owner_id UUID REFERENCES users(id), -- For reporting and analytics
  
  -- Call details
  direction TEXT NOT NULL DEFAULT 'outbound',
  attempt_no INT NOT NULL DEFAULT 1,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  
  -- Call outcome
  outcome TEXT, -- 'completed', 'no_answer', 'voicemail', 'busy', 'failed'
  disposition TEXT, -- 'interested', 'not_interested', 'callback', 'scheduled', 'wrong_number'
  sentiment_score DECIMAL(3,2), -- -1.0 to 1.0
  
  -- Retell AI data
  retell_call_id TEXT,
  transcript TEXT,
  summary TEXT,
  analysis JSONB DEFAULT '{}'::jsonb,
  
  -- Additional metadata
  meta JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Appointments table - Updated for business owner model
CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id), -- Business owner
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id),
  
  -- Appointment details
  appointment_type TEXT DEFAULT 'consultation', -- 'consultation', 'follow_up', 'emergency'
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  
  -- Appointment status
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'
  confirmation_sent_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  
  -- Location/method
  is_telemedicine BOOLEAN DEFAULT false,
  meeting_link TEXT,
  office_address TEXT,
  
  -- Payment and pricing
  price NUMERIC(10,2),
  payment_status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'refunded'
  
  -- Integration IDs
  gcal_event_id TEXT,
  
  -- Notes
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER touch_appointments_updated_at
BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

-- Payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES users(id), -- Business owner
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id),
  
  -- Payment details
  expected_amount NUMERIC(10,2),
  paid_amount NUMERIC(10,2),
  currency TEXT DEFAULT 'BRL',
  payment_method TEXT, -- 'credit_card', 'pix', 'bank_transfer', 'cash'
  
  -- Payment status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'paid', 'failed', 'refunded'
  
  -- External references
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  receipt_url TEXT,
  
  -- OCR and receipt processing
  ocr_amount NUMERIC(10,2),
  ocr_raw JSONB,
  receipt_verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER touch_payments_updated_at
BEFORE UPDATE ON payments FOR EACH ROW EXECUTE PROCEDURE trg_touch_updated_at();

-- Add foreign key constraint for default agent
ALTER TABLE users ADD CONSTRAINT fk_users_default_agent 
FOREIGN KEY (default_agent_id) REFERENCES agents(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_specialties_name ON specialties (lower(name));
CREATE INDEX IF NOT EXISTS idx_specialties_tags ON specialties USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_specialties_syn  ON specialties USING GIN (synonyms);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_active     ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_default_agent ON users(default_agent_id);

CREATE INDEX IF NOT EXISTS idx_doctors_owner    ON doctors(owner_id);
CREATE INDEX IF NOT EXISTS idx_doctors_active   ON doctors(is_active);
CREATE INDEX IF NOT EXISTS idx_doctors_specialty ON doctors(specialty);
CREATE INDEX IF NOT EXISTS idx_doctors_city     ON doctors(lower(city));
CREATE INDEX IF NOT EXISTS idx_doctors_tags     ON doctors USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_doctors_lang     ON doctors USING GIN (languages);
CREATE INDEX IF NOT EXISTS idx_doctors_spec_id  ON doctors(specialty_id);

CREATE INDEX IF NOT EXISTS idx_agents_owner     ON agents(owner_id);
CREATE INDEX IF NOT EXISTS idx_agents_active    ON agents(is_active);
CREATE INDEX IF NOT EXISTS idx_agents_retell    ON agents(retell_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_specialties ON agents USING GIN (specialties);

CREATE INDEX IF NOT EXISTS idx_leads_owner      ON leads(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_next_retry ON leads(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_doctor ON leads(assigned_doctor_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_agent ON leads(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_phone      ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_created    ON leads(created_at);

CREATE INDEX IF NOT EXISTS idx_call_attempts_lead ON call_attempts(lead_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_doctor ON call_attempts(doctor_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_agent ON call_attempts(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_owner ON call_attempts(owner_id);
CREATE INDEX IF NOT EXISTS idx_call_attempts_outcome ON call_attempts(outcome);

CREATE INDEX IF NOT EXISTS idx_appointments_owner ON appointments(owner_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- Insert default specialties
INSERT INTO specialties (name, short_desc, synonyms, tags) VALUES
('Cardiology', 'Heart and cardiovascular system', ARRAY['cardiologia', 'coração', 'cardiovascular'], ARRAY['heart', 'cardiac']),
('Neurology', 'Brain and nervous system', ARRAY['neurologia', 'cérebro', 'sistema nervoso'], ARRAY['brain', 'neuro']),
('Orthopedics', 'Bones, joints, and muscles', ARRAY['ortopedia', 'ossos', 'articulações'], ARRAY['bones', 'joints']),
('Pediatrics', 'Children healthcare', ARRAY['pediatria', 'crianças', 'infantil'], ARRAY['children', 'kids']),
('Internal Medicine', 'General internal medicine', ARRAY['clínica geral', 'medicina interna'], ARRAY['general', 'internal']),
('Dermatology', 'Skin conditions', ARRAY['dermatologia', 'pele'], ARRAY['skin', 'derma']),
('Gynecology', 'Women''s health', ARRAY['ginecologia', 'saúde da mulher'], ARRAY['women', 'gyneco']),
('Psychiatry', 'Mental health', ARRAY['psiquiatria', 'saúde mental'], ARRAY['mental', 'psychiatric']),
('Endocrinology', 'Hormones and metabolism', ARRAY['endocrinologia', 'hormônios'], ARRAY['hormones', 'diabetes']),
('Gastroenterology', 'Digestive system', ARRAY['gastroenterologia', 'digestivo'], ARRAY['stomach', 'digestive']);

-- Insert default admin user
INSERT INTO users (email, password_hash, name, role, specialty, about_me) VALUES 
('admin@medcare.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaVKaVsJyTjOG3VWs1bwKBrF6', 'System Admin', 'admin', 'Administration', 'System administrator for MedCare platform');

-- Insert sample owner
INSERT INTO users (email, password_hash, name, role, specialty, about_me) VALUES 
('owner@clinica.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMaVKaVsJyTjOG3VWs1bwKBrF6', 'Dr. Carlos Silva', 'owner', 'Cardiology', 'Experienced cardiologist with 15 years of practice in São Paulo');

-- Migration: Add date-specific availability to doctors table
-- This allows doctors to block specific dates when they're unavailable

-- Add date_specific_availability field to doctors table
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS date_specific_availability JSONB DEFAULT '[]'::jsonb;

-- Add comment to explain the field structure
COMMENT ON COLUMN doctors.date_specific_availability IS 'Array of date-specific availability blocks: [{"date": "2024-01-15", "type": "unavailable", "reason": "Holiday"}, {"date": "2024-01-20", "type": "modified_hours", "start": "10:00", "end": "14:00", "reason": "Half day"}]';

-- Create index for efficient querying of date-specific availability
CREATE INDEX IF NOT EXISTS idx_doctors_date_specific_availability ON doctors USING GIN (date_specific_availability);

-- Update existing doctors to have empty array for date_specific_availability
UPDATE doctors SET date_specific_availability = '[]'::jsonb WHERE date_specific_availability IS NULL;

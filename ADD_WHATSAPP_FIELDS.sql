-- Add WhatsApp Business integration fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS whatsapp_phone_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS whatsapp_access_token TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_business_account_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS whatsapp_phone_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS whatsapp_phone_number_display VARCHAR(50),
ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS whatsapp_connected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS whatsapp_connected_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS whatsapp_webhook_verify_token VARCHAR(255);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_phone_id ON users(whatsapp_phone_id);
CREATE INDEX IF NOT EXISTS idx_users_whatsapp_connected ON users(whatsapp_connected);

-- Add comments for documentation
COMMENT ON COLUMN users.whatsapp_phone_id IS 'Meta WhatsApp Business Phone Number ID';
COMMENT ON COLUMN users.whatsapp_access_token IS 'Meta access token for WhatsApp Business API (should be encrypted)';
COMMENT ON COLUMN users.whatsapp_business_account_id IS 'Meta Business Account ID';
COMMENT ON COLUMN users.whatsapp_phone_number IS 'WhatsApp Business phone number in E.164 format (+1234567890)';
COMMENT ON COLUMN users.whatsapp_phone_number_display IS 'Display format of WhatsApp phone number';
COMMENT ON COLUMN users.whatsapp_verified IS 'Whether the WhatsApp Business number is verified by Meta';
COMMENT ON COLUMN users.whatsapp_connected IS 'Whether WhatsApp Business is currently connected';
COMMENT ON COLUMN users.whatsapp_connected_at IS 'Timestamp when WhatsApp was connected';
COMMENT ON COLUMN users.whatsapp_webhook_verify_token IS 'Token for webhook verification';

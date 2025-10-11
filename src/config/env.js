import 'dotenv/config';

export const env = {
  PORT: parseInt(process.env.PORT || '8080', 10),
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:8080',

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER: process.env.TWILIO_FROM_NUMBER,
  TWILIO_VOICE_NUMBER: process.env.TWILIO_VOICE_NUMBER,
  TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,

  RETELL_API_KEY: process.env.RETELL_API_KEY,
  RETELL_FROM_NUMBER: process.env.RETELL_FROM_NUMBER,
  RETELL_AGENT_OUT: process.env.RETELL_AGENT_OUT,
  CONVERSATION_FLOW_ID: process.env.CONVERSATION_FLOW_ID,

  GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GCAL_CALENDAR_ID: process.env.GCAL_CALENDAR_ID,
  
  // Google OAuth2 for Calendar
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  MINDEE_API_KEY: process.env.MINDEE_API_KEY,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  CURRENCY: (process.env.CURRENCY || 'BRL').toLowerCase(),

  // WhatsApp Business API
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'geniumed-whatsapp-verify-token',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET,

  // Authentication
  JWT_SECRET: process.env.JWT_SECRET || 'geniumed-secret-key-change-in-production'
};

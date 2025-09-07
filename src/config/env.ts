import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  APP_BASE_URL: z.string().url(),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  TWILIO_ACCOUNT_SID: z.string(),
  TWILIO_AUTH_TOKEN: z.string(),
  TWILIO_VOICE_NUMBER: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),

  RETELL_API_KEY: z.string(),
  RETELL_FROM_NUMBER: z.string().optional(),
  RETELL_AGENT_OUT: z.string().optional(),
  RETELL_AGENT_IN: z.string().optional(),
  RETELL_SIP_DOMAIN: z.string().optional(),

  GOOGLE_PROJECT_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GCAL_CALENDAR_ID: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  CURRENCY: z.string().default('brl')
});

export const env = schema.parse(process.env);
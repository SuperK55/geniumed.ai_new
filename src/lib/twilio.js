import Twilio from 'twilio';
import { env } from '../config/env.js';
export const twilio = Twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

// src/middleware/verifyTwilio.js
import twilioPkg from 'twilio';
import { env } from '../config/env.js';

const { validateRequest } = twilioPkg;

export function verifyTwilio(req, res, next) {
  // Build the exact public URL Twilio used (must match your console/webhook)
  const signature = String(req.headers['x-twilio-signature'] || '');
  const url = `${env.APP_BASE_URL}${req.originalUrl}`;

  // validateRequest(accountAuthToken, twilioSignatureHeader, fullUrl, POST params)
  const ok = validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, req.body);
  if (!ok) return res.status(403).send('forbidden');

  next();
}

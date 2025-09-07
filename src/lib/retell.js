import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';

export function verifyRetellSignature(rawBody, signatureHeader){
  if (!signatureHeader) return false;
  const [algo, sent] = String(signatureHeader).split('=');
  if (algo !== 'sha256' || !sent) return false;
  const h = crypto.createHmac('sha256', env.RETELL_API_KEY);
  h.update(rawBody);
  return h.digest('hex') === sent;
}

export async function retellCreatePhoneCall(opts){
  const r = await axios.post('https://api.retellai.com/v1/calls/phone', opts, {
    headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, 'Content-Type': 'application/json' }
  });
  return r.data;
}

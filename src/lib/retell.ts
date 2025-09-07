import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';

export function verifyRetellSignature(rawBody: string, signatureHeader?: string): boolean {
  if (!signatureHeader) return false;
  const [algo, sent] = signatureHeader.split('=');
  if (algo !== 'sha256' || !sent) return false;
  const h = crypto.createHmac('sha256', env.RETELL_API_KEY);
  h.update(rawBody);
  return h.digest('hex') === sent;
}

export async function retellCreatePhoneCall(opts: {
  from_number: string;
  to_number: string;
  retell_llm_dynamic_variables?: Record<string,string>;
}) {
  const r = await axios.post('https://api.retellai.com/v1/calls/phone', opts, {
    headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, 'Content-Type':'application/json' }
  });
  return r.data;
}
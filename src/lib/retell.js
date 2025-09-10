import crypto from 'crypto';
import axios from 'axios';
import { env } from '../config/env.js';
import Retell from 'retell-sdk';

const client = new Retell({ apiKey: env.RETELL_API_KEY });

export function verifyRetellSignature(rawBody, signatureHeader){
  if (!signatureHeader) return false;
  const [algo, sent] = String(signatureHeader).split('=');
  if (algo !== 'sha256' || !sent) return false;
  const h = crypto.createHmac('sha256', env.RETELL_API_KEY);
  h.update(rawBody);
  return h.digest('hex') === sent;
}

export async function retellCreatePhoneCall(opts){
  const r = await client.call.createPhoneCall({
    to_number: opts.to_number,
    from_number: opts.from_number,
    retell_llm_dynamic_variables: opts.retell_llm_dynamic_variables
  });
  return r;
}

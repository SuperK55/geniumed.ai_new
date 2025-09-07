import { retellCreatePhoneCall } from '../lib/retell.js';
import { env } from '../config/env.js';

export async function dialOutbound({ to, vars }:{ to: string; vars?: Record<string,string> }){
  if(!env.RETELL_FROM_NUMBER) throw new Error('RETELL_FROM_NUMBER not set');
  const phoneLast4 = to.replace(/\D/g,'').slice(-4);
  const payloadVars = { phone_last4: phoneLast4, ...(vars||{}) };
  const r = await retellCreatePhoneCall({
    from_number: env.RETELL_FROM_NUMBER,
    to_number: to,
    retell_llm_dynamic_variables: payloadVars
  });
  return r;
}
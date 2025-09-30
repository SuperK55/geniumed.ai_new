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
  try {
    // Validate required parameters
    if (!opts.to_number && !opts.customer_number) {
      throw new Error('Phone number (to_number or customer_number) is required');
    }

    if (!env.RETELL_FROM_NUMBER && !opts.from_number) {
      throw new Error('From number is required (set RETELL_FROM_NUMBER env var or provide from_number)');
    }

    if (!opts.agent_id) {
      throw new Error('Agent ID is required for outbound calls');
    }

    const callParams = {
      to_number: opts.to_number || opts.customer_number,
      from_number: opts.from_number || env.RETELL_FROM_NUMBER,
      retell_llm_dynamic_variables: opts.retell_llm_dynamic_variables || {}
    };

    console.log('=================================================Call params:', callParams);

    // Add metadata if provided
    if (opts.metadata) {
      callParams.metadata = opts.metadata;
    }

    const r = await client.call.createPhoneCall(callParams);
    return r;
  } catch (error) {
    console.error('Retell call creation error:', error);
    throw new Error(`Failed to create Retell call: ${error.message}`);
  }
}

export async function retellDeleteAgent(agentId){
  try {
    if (!agentId) {
      throw new Error('Agent ID is required for deletion');
    }

    console.log('Deleting Retell agent:', agentId);

    const response = await client.agent.delete(agentId);
    console.log('Retell agent deleted successfully:', agentId);
    return response;
  } catch (error) {
    console.error('Retell agent deletion error:', error);
    throw new Error(`Failed to delete Retell agent: ${error.message}`);
  }
}

import axios from 'axios';
import { env } from '../config/env.js';
export async function ocrReceiptAmount(imageBytes: Uint8Array): Promise<number|null>{
  if(!env.MINDEE_API_KEY) return null;
  const r = await axios.post('https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict', imageBytes, {
    headers:{'Authorization':`Token ${env.MINDEE_API_KEY}`,'Content-Type':'application/octet-stream'}
  });
  const val = r.data?.document?.inference?.prediction?.total_amount?.value;
  return typeof val==='number'?val:null;
}
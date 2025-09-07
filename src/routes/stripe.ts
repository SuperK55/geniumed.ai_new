import { Router } from 'express';
import { stripe } from '../lib/stripe.js';
import type { Request, Response } from 'express';

const r = Router();
function getRawBody(req: Request){ return (req as any).rawBody || Buffer.from(JSON.stringify(req.body||{})); }

r.post('/webhook/stripe', (req:Request,res:Response)=>{
  const sig = String(req.headers['stripe-signature']||'');
  let event;
  try{ event = stripe.webhooks.constructEvent(getRawBody(req), sig, process.env.STRIPE_WEBHOOK_SECRET || ''); }
  catch(e:any){ return res.status(400).send(`Webhook Error: ${e.message}`); }

  switch(event.type){
    case 'checkout.session.completed': {
      const session:any = event.data.object;
      const leadId = session.metadata?.lead_id;
      const amount_total = session.amount_total;
      // TODO: mark payment approved for leadId
      break;
    }
    default: break;
  }
  res.json({ received:true });
});

r.get('/pay/success',(_req,res)=>res.json({ok:true,status:'paid'}));
r.get('/pay/cancel',(_req,res)=>res.json({ok:true,status:'cancelled'}));
export default r;
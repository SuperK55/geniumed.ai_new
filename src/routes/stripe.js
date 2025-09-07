import { Router } from 'express';
import { stripe } from '../lib/stripe.js';

const r = Router();
const getRawBody = (req) => req.rawBody || Buffer.from(JSON.stringify(req.body||{}));

r.post('/webhook/stripe', (req,res)=>{
  const sig = String(req.headers['stripe-signature']||'');
  let event;
  try{ event = stripe.webhooks.constructEvent(getRawBody(req), sig, process.env.STRIPE_WEBHOOK_SECRET || ''); }
  catch(e){ return res.status(400).send(`Webhook Error: ${e.message}`); }

  switch(event.type){
    case 'checkout.session.completed': {
      const session = event.data.object;
      const leadId = session.metadata?.lead_id;
      const amount_total = session.amount_total;
      // TODO: update payments for leadId, set status=approved
      break;
    }
    default: break;
  }
  res.json({ received:true });
});

r.get('/pay/success',(_req,res)=>res.json({ok:true,status:'paid'}));
r.get('/pay/cancel',(_req,res)=>res.json({ok:true,status:'cancelled'}));

export default r;

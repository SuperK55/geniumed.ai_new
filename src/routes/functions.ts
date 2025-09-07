import { Router } from 'express';
import { bookAppointment } from '../services/appointments.js';
import { stripe, currency } from '../lib/stripe.js';
import { twilio } from '../lib/twilio.js';
import { supa } from '../lib/supabase.js';

const r = Router();
r.use((req,_res,next)=>{ next(); });

r.post('/fn/check-identity', async (req,res)=>{
  const { lead_id, confirm_name, last4 } = req.body.args || {};
  // TODO: read lead from DB and compare
  return res.json({ match: true, reason:'ok' });
});

r.post('/fn/create-payment-link', async (req,res)=>{
  const { lead_id, amount, customer_email, description } = req.body.args || {};
  if (!amount) return res.status(400).json({ error: 'amount required' });
  const unitAmount = Math.round(Number(amount)*100);
  const session = await stripe.checkout.sessions.create({
    mode:'payment',
    line_items:[{ price_data:{ currency, product_data:{ name: description || 'Consulta médica - Geniumed' }, unit_amount: unitAmount }, quantity:1 }],
    customer_email,
    metadata:{ lead_id: String(lead_id || '') },
    success_url: `${process.env.APP_BASE_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.APP_BASE_URL}/pay/cancel`
  });
  // TODO: insert into payments table (pending)
  res.json({ url: session.url, amount, currency });
});

r.post('/fn/send-payment-link', async (req,res)=>{
  const { to, url } = req.body.args || {};
  if(!to || !url) return res.status(400).json({ error:'to and url required' });
  await twilio.messages.create({ to, messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, body: `Segue o link de pagamento seguro: ${url}` });
  res.json({ sent:true });
});

r.post('/fn/check-availability', async (_req,res)=>{
  res.json({ ok:true, next_slots:['2025-09-08T14:00:00-03:00','2025-09-08T16:00:00-03:00'] });
});

r.post('/fn/book-appointment', async (req,res)=>{
  const { doctor_email, start, duration_min, timezone } = req.body.args || {};
  if(!doctor_email || !start) return res.status(400).json({ error:'doctor_email and start required' });
  const ev = await bookAppointment({ doctor_email, start, durationMin: duration_min, timezone });
  res.json({ ok:true, gcal_event_id: ev.id, gcal_link: ev.htmlLink });
});

r.post('/fn/set-communication-preference', async (req,res)=>{
  const { lead_id, preferred_channel } = req.body.args || {};
  if(!lead_id || !preferred_channel) return res.status(400).json({ error:'lead_id and preferred_channel required' });
  await supa.from('leads').update({ preferred_channel }).eq('id', lead_id);
  res.json({ ok:true });
});

r.post('/fn/schedule-call', async (req,res)=>{
  const { lead_id, when_iso } = req.body.args || {};
  if(!lead_id || !when_iso) return res.status(400).json({ error:'lead_id and when_iso required' });
  await supa.from('leads').update({ status:'reschedule', next_retry_at: when_iso }).eq('id', lead_id);
  res.json({ ok:true });
});

r.post('/fn/recommend_doctor', async (req, res) => {
  const { city, need, specialty, language } = req.body.args || {};

  const { data, error } = await supa
    .from('doctors')
    .select('id,name,specialty,city,languages,tags,description,telemedicine,specialty_id,specialties(name,tags,synonyms)')
    .eq('is_active', true)
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });

  function score(doc: any) {
    let s = 0;
    const specName = (doc.specialty || doc.specialties?.name || '').toLowerCase();
    if (specialty && specName.includes(String(specialty).toLowerCase())) s += 4;
    if (city && doc.city && doc.city.toLowerCase() === String(city).toLowerCase()) s += 2;
    if (language && Array.isArray(doc.languages) &&
        doc.languages.some((l: string) => l.toLowerCase().startsWith(String(language).toLowerCase()))) s += 2;
    if (need) {
      const toks = String(need).toLowerCase().split(/[^a-zá-ú0-9]+/i).filter(Boolean);
      const hay = new Set<string>([
        ...(doc.tags || []),
        ...((doc.specialties?.tags || []) as string[]),
        ...((doc.specialties?.synonyms || []) as string[])
      ].map((t: string) => t.toLowerCase()));
      if (toks.some((t: string) => hay.has(t))) s += 3;
    }
    return s; // no price/duration bias
  }

  const ranked = (data || []).map((d: any) => ({ d, s: score(d) })).sort((a, b) => b.s - a.s);
  if (!ranked.length || ranked[0].s <= 0) return res.json({ ok: false, reason: 'no_match' });

  const top = ranked[0].d;
  return res.json({
    ok: true,
    doctor: {
      id: top.id,
      name: top.name,
      specialty: top.specialty || top.specialties?.name || null,
      city: top.city,
      languages: top.languages,
      telemedicine: top.telemedicine,
      tags: top.tags,
      description: top.description,
      specialty_id: top.specialty_id
    }
  });
});

export default r;
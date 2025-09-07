import { Router } from 'express';
import { dialOutbound } from '../services/dialer.js';
import { supa } from '../lib/supabase.js';
import { pickDoctorForLead } from '../services/doctors.js';

const r = Router();

/** Capture lead + trigger outbound call */
r.post('/lead/submit', async (req, res) => {
  const { name, phone, city, specialty, reason, whatsapp, preferred_channel } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  const { data: leadRow, error } = await supa.from('leads').insert({
    name, phone, city, specialty, reason, whatsapp,
    preferred_channel: preferred_channel || 'call', status: 'calling'
  }).select('id,name,city,specialty,reason').single();
  if (error) return res.status(500).json({ error: error.message });

  const doc = await pickDoctorForLead({ city, need: reason, specialty });
  const doctorSpecialty = (doc?.specialty || doc?.specialties?.name || '') || '';
  const vars = {
    lead_id: leadRow.id,
    name: leadRow.name || '',
    city: leadRow.city || '',
    specialty: leadRow.specialty || doctorSpecialty || '',
    reason: leadRow.reason || '',
    doctor_id: doc?.id || '',
    doctor_name: doc?.name || '',
    doctor_specialty: doctorSpecialty || '',
    doctor_city: doc?.city || '',
    doctor_description: doc?.description || '',
    doctor_languages: Array.isArray(doc?.languages) ? doc.languages.join(', ') : '',
    doctor_tags: Array.isArray(doc?.tags) ? doc.tags.join(', ') : '',
    telemedicine: doc?.telemedicine ? 'true' : 'false',
    price_first: doc?.price_first != null ? String(doc.price_first) : '',
    price_return: doc?.price_return != null ? String(doc.price_return) : ''
  };

  try {
    const resp = await dialOutbound({ to: phone, vars });
    await supa.from('call_attempts').insert({
      lead_id: leadRow.id, attempt_no: 1, started_at: new Date().toISOString(),
      retell_call_id: resp.call_id, outcome: 'initiated', meta: { recommended_doctor_id: doc?.id || null }
    });
    res.json({ ok: true, call: resp, lead_id: leadRow.id, doctor_id: doc?.id ?? null });
  } catch (e) {
    await supa.from('leads').update({ status: 'new' }).eq('id', leadRow.id);
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default r;

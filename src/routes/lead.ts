import { Router } from 'express';
import { dialOutbound } from '../services/dialer.js';
import { supa } from '../lib/supabase.js';
import { pickDoctorForLead } from '../services/doctors.js';

const r = Router();

/** Capture lead + trigger outbound call (doctor-aware) */
r.post('/lead/submit', async (req, res) => {
  const { name, phone, city, specialty, reason, whatsapp, preferred_channel } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'name and phone required' });

  // 1) Save the lead
  const { data: leadRow, error } = await supa.from('leads').insert({
    name, phone, city, specialty, reason, whatsapp,
    preferred_channel: preferred_channel || 'call',
    status: 'calling'
  }).select('id,name,city,specialty,reason').single();

  if (error) return res.status(500).json({ error: error.message });

  // 2) Pick a suitable doctor (uses doctors.specialty_id -> specialties join internally)
  const doc = await pickDoctorForLead({ city, need: reason, specialty });

  // Build Retell dynamic variables (all strings)
  const doctorSpecialty =
    (doc?.specialty || doc?.specialties?.name || '') as string;

  const vars: Record<string, string> = {
    // lead context
    name: leadRow.name || '',
    city: leadRow.city || '',
    specialty: leadRow.specialty || doctorSpecialty || '',
    reason: leadRow.reason || '',

    // doctor context (adapted to your new schema)
    doctor_id: doc?.id || '',
    doctor_name: doc?.name || '',
    doctor_specialty: doctorSpecialty || '',
    doctor_city: doc?.city || '',
    doctor_description: doc?.description || '',
    doctor_languages: Array.isArray(doc?.languages) ? doc!.languages.join(', ') : '',
    doctor_tags: Array.isArray(doc?.tags) ? doc!.tags.join(', ') : '',
    telemedicine: doc?.telemedicine ? 'true' : 'false',

    // NOTE: prices are passed only for speaking; not used for ranking
    price_first: doc?.price_first != null ? String(doc.price_first) : '',
    price_return: doc?.price_return != null ? String(doc.price_return) : ''
  };

  try {
    // 3) Dial with variables (dialer adds phone_last4 automatically)
    const resp = await dialOutbound({ to: phone, vars });

    // 4) Log attempt (+ keep recommended doctor in meta for debugging)
    await supa.from('call_attempts').insert({
      lead_id: leadRow.id,
      attempt_no: 1,
      started_at: new Date().toISOString(),
      retell_call_id: resp.call_id,
      outcome: 'initiated',
      meta: { recommended_doctor_id: doc?.id || null }
    });

    return res.json({ ok: true, call: resp, lead_id: leadRow.id, doctor_id: doc?.id ?? null });
  } catch (e: any) {
    await supa.from('leads').update({ status: 'new' }).eq('id', leadRow.id);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default r;

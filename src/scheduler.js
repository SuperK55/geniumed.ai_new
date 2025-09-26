import cron from 'node-cron';
import { supa } from './lib/supabase.js';
import { dialOutbound } from './services/dialer.js';
import { pickDoctorForLead } from './services/doctors.js';
import { log } from './config/logger.js';
import { twilio } from './lib/twilio.js';

cron.schedule('*/10 * * * *', async () => {
  const nowIso = new Date().toISOString();
  const { data: leads, error } = await supa.from('leads').select('*').lte('next_retry_at', nowIso).in('status',['no_answer','reschedule']);
  if (error) return log.error('retry query', error.message);
  for (const lead of leads || []) {
    const { data: attempts } = await supa.from('call_attempts').select('attempt_no').eq('lead_id', lead.id).order('attempt_no',{ascending:false}).limit(1);
    const lastNo = attempts?.[0]?.attempt_no || 1;
    if (lastNo >= 3) continue;

    const doc = await pickDoctorForLead({ city: lead.city, need: lead.reason, specialty: lead.specialty });
    const vars = {
      lead_id: lead.id, name: lead.name, city: lead.city || '', specialty: lead.specialty || '', reason: lead.reason || '',
      doctor_id: doc?.id || '', doctor_name: doc?.name || '', doctor_specialty: doc?.specialty || '',
      doctor_city: doc?.city || '', doctor_description: doc?.bio || '',
      doctor_languages: Array.isArray(doc?.languages) ? doc.languages.join(', ') : '',
      doctor_tags: Array.isArray(doc?.tags) ? doc.tags.join(', ') : '',
      telemedicine: doc?.telemedicine_available ? 'true' : 'false',
      price_first: doc?.consultation_price != null ? String(doc.consultation_price) : '',
      price_return: doc?.return_consultation_price != null ? String(doc.return_consultation_price) : ''
    };
    try {
      const resp = await dialOutbound({ to: lead.phone, vars });
      await supa.from('call_attempts').insert({
        lead_id: lead.id,
        attempt_no: lastNo + 1,
        started_at: new Date().toISOString(),
        retell_call_id: resp.call_id,
        outcome: 'initiated'
      });
      await supa.from('leads')
        .update({ status: 'calling', next_retry_at: null })
        .eq('id', lead.id);
    } catch (e) {
      log.error('retry dial error', e.message);
    }
  }
});

/* WhatsApp fallback after 3 failed attempts */
cron.schedule('5 * * * *', async () => {
  const { data: leads, error } = await supa
    .from('leads')
    .select('*')
    .eq('status', 'whatsapp_outreach');

  if (error) return log.error('whatsapp query', error.message);

  for (const lead of leads || []) {
    const to =
      lead.whatsapp ||
      (String(lead.phone || '').startsWith('whatsapp:')
        ? lead.phone
        : `whatsapp:${lead.phone}`);

    if (!to) continue;

    try {
      await twilio.messages.create({
        to,
        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
        body: `Olá ${String(lead.name || '').split(' ')[0]}! Tentamos falar por telefone. Você prefere continuar por *ligação* ou *WhatsApp*? Responda "ligar" ou "WhatsApp".`
      });
      await supa
        .from('leads')
        .update({ status: 'waiting_preference' })
        .eq('id', lead.id);
    } catch (e) {
      log.error('whatsapp outreach error', e.message);
    }
  }
});


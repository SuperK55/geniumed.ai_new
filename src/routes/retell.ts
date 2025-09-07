import { Router } from 'express';
import { verifyRetell } from '../middleware/verifyRetell.js';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';

const r = Router();

function nextRetryAt(_attemptNo:number){
  const now=new Date();
  now.setHours(now.getHours()+4);
  return now.toISOString();
}

r.post('/retell/webhook', verifyRetell, async (req, res) => {
  const evt = req.body;
  log.info('retell evt', evt?.type, evt?.call_id);

  const { data: attempts } = await supa.from('call_attempts').select('*').eq('retell_call_id', evt.call_id).limit(1);
  const attempt = attempts?.[0];
  if (!attempt) return res.sendStatus(200);

  if (evt.type === 'call_started') {
    await supa.from('call_attempts').update({ started_at: new Date().toISOString() }).eq('id', attempt.id);
  }

  if (evt.type === 'call_ended') {
    const outcome = evt.outcome || evt.summary?.result || evt.disconnect_reason || 'ended';
    await supa.from('call_attempts').update({ ended_at: new Date().toISOString(), outcome }).eq('id', attempt.id);

    const { data: leads } = await supa.from('leads').select('*').eq('id', attempt.lead_id).limit(1);
    const lead = leads?.[0];
    if (!lead) return res.sendStatus(200);

    const lower = String(outcome).toLowerCase();
    if (/(no[_-]?answer|busy|timeout)/.test(lower)) {
      const nextN = (attempt.attempt_no || 1) + 1;
      if (nextN <= 3) {
        const nextAt = nextRetryAt(nextN);
        await supa.from('leads').update({ status: 'no_answer', next_retry_at: nextAt }).eq('id', lead.id);
      } else {
        await supa.from('leads').update({ status: 'whatsapp_outreach', preferred_channel: 'whatsapp', next_retry_at: null }).eq('id', lead.id);
      }
    } else if (/divergent/.test(lower)) {
      await supa.from('leads').update({ status: 'divergent' }).eq('id', lead.id);
    } else {
      await supa.from('leads').update({ status: 'qualified' }).eq('id', lead.id);
    }
  }

  if (evt.type === 'call_analyzed') {
    await supa.from('call_attempts').update({ transcript: evt.transcript || evt.analysis || null }).eq('id', attempt.id);
  }

  res.sendStatus(200);
});

export default r;
import { Router } from 'express';
import { verifyRetell } from '../middleware/verifyRetell.js';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { Retell } from 'retell-sdk';
import { env } from '../config/env.js';

const r = Router();
// const nextRetryAt = () => { const n=new Date(); n.setHours(n.getHours()+4); return n.toISOString(); };

function computeNextRetry(attemptNo, { inVoicemail = false } = {}) {
  const now = new Date();

  // If voicemail, try again soon (15–25 min) to catch them shortly after
  if (inVoicemail) {
    const minutes = 15 + Math.floor(Math.random() * 11); // 15..25
    const d = new Date(now.getTime() + minutes * 60 * 1000);
    return d.toISOString();
  }

  // Otherwise stagger across day-parts to avoid voicemail again
  const daypartHours = [10, 15, 19]; // local time windows
  const nextHour = daypartHours[(attemptNo - 1) % daypartHours.length];
  const d = new Date(now);
  // if we're past today’s window, schedule for tomorrow
  if (now.getHours() >= nextHour) d.setDate(d.getDate() + 1);
  d.setHours(nextHour, Math.floor(Math.random() * 20) * 3, 0, 0); // randomize minutes
  return d.toISOString();
}

async function findAttemptByCallId(callId) {
  const { data, error } = await supa
    .from('call_attempts')
    .select('*')
    .eq('retell_call_id', callId)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

async function maxAttemptNo(leadId) {
  const { data, error } = await supa
    .from('call_attempts')
    .select('attempt_no')
    .eq('lead_id', leadId)
    .order('attempt_no', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.attempt_no || 1;
}

// r.post('/retell/webhook', async (req, res) => {
//   if (
//     !Retell.verify(
//       JSON.stringify(req.body),
//       env.RETELL_API_KEY,
//       req.headers["x-retell-signature"] || '',
//     )
//   ) {
//     console.error("Invalid signature");
//     return;
//   }
//   const evt = req.body;
//   log.info('retell evt', evt);

//   const { data: attempts } = await supa.from('call_attempts').select('*').eq('retell_call_id', evt.call?.call_id).limit(1);
//   const attempt = attempts?.[0];
//   if (!attempt) return res.sendStatus(200);

//   if (evt.event === 'call_started')
//     await supa.from('call_attempts').update({ started_at: new Date().toISOString() }).eq('id', attempt.id);

//   if (evt.event === 'call_ended') {
//     const outcome = evt.call?.disconnection_reason || evt.call?.call_analysis?.call_successful ? 'completed' : 'ended';
//     await supa.from('call_attempts').update({ ended_at: new Date().toISOString(), outcome }).eq('id', attempt.id);

//     const { data: leads } = await supa.from('leads').select('*').eq('id', attempt.lead_id).limit(1);
//     const lead = leads?.[0]; if (!lead) return res.sendStatus(200);

//     const lower = String(outcome).toLowerCase();
//     if (/(no[_-]?answer|busy|timeout|user_hangup)/.test(lower)) {
//       const { data: last } = await supa.from('call_attempts').select('attempt_no').eq('lead_id', lead.id).order('attempt_no',{ascending:false}).limit(1);
//       const nextN = (last?.[0]?.attempt_no || 1) + 1;
//       if (nextN <= 3)
//         await supa.from('leads').update({ status: 'no_answer', next_retry_at: nextRetryAt() }).eq('id', lead.id);
//       else
//         await supa.from('leads').update({ status: 'whatsapp_outreach', preferred_channel: 'whatsapp', next_retry_at: null }).eq('id', lead.id);
//     } else if (/divergent/.test(lower)) {
//       await supa.from('leads').update({ status: 'divergent' }).eq('id', lead.id);
//     } else {
//       await supa.from('leads').update({ status: 'qualified' }).eq('id', lead.id);
//     }
//   }

//   if (evt.event === 'call_analyzed')
//     await supa.from('call_attempts').update({ transcript: evt.call?.transcript || evt.call?.call_analysis || null }).eq('id', attempt.id);

//   res.sendStatus(200);
// });

r.post('/retell/webhook', async (req, res) => {

  if (
    !Retell.verify(
      JSON.stringify(req.body),
      env.RETELL_API_KEY,
      req.headers["x-retell-signature"] || '',
    )
  ) {
    console.error("Invalid signature");
    return;
  }
  try {
    const evt = req.body || {};
    const type = evt.type || evt.event; // Retell may send either
    const c = evt.call || {};
    const callId = c.call_id || evt.call_id || 'unknown';

    log.info('retell evt', { type, call_id: callId });

    const attempt = await findAttemptByCallId(callId);
    if (!attempt) {
      // Not one of ours (or already cleaned up) — ack to avoid retries
      return res.sendStatus(200);
    }

    if (type === 'call_started') {
      await supa
        .from('call_attempts')
        .update({ started_at: new Date().toISOString() })
        .eq('id', attempt.id);
      return res.sendStatus(200);
    }

    if (type === 'call_ended') {
      // Persist raw outcome for debugging
      const transcript = (c.transcript || '').toLowerCase();
      const collected = JSON.stringify(c.collected_dynamic_variables || {});
      const outcomeRaw = [
        evt.outcome,
        c.disconnection_reason,
        c.call_status,
        c.summary?.result,
        c.summary?.call_outcome
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      // Voicemail detection (PT/EN variants + Retell analysis)
      const inVoicemail =
        Boolean(c.call_analysis?.in_voicemail) ||
        /voicemail|voice[- ]?mail|caixa postal|correio de voz|deixe sua mensagem|ap[oó]s o sinal|voymail/i.test(
          transcript
        ) ||
        /not available|mismatched_reason.*not available/i.test(collected);

      const NO_HUMAN =
        inVoicemail ||
        /(no ?answer|no[_-]?pickup|didn'?t pick|missed|timeout|busy|failed|cancelled|declined|unreachable)/i.test(
          outcomeRaw
        );
      const DIVERGENT =
        /(divergent|identity[_-]?fail|mismatch name|name mismatch)/i.test(outcomeRaw);

      log.info('retell call_ended parsed', {
        call_id: callId,
        inVoicemail,
        NO_HUMAN,
        DIVERGENT,
        outcomeRaw
      });

      // Update attempt outcome + timestamp
      await supa
        .from('call_attempts')
        .update({
          ended_at: new Date().toISOString(),
          outcome: evt.outcome || c.disconnection_reason || (inVoicemail ? 'voicemail' : 'ended')
        })
        .eq('id', attempt.id);

      // Load lead
      const { data: leadRows, error: leadErr } = await supa
        .from('leads')
        .select('*')
        .eq('id', attempt.lead_id)
        .limit(1);
      if (leadErr) throw new Error(leadErr.message);
      const lead = leadRows?.[0];
      if (!lead) return res.sendStatus(200);

      if (NO_HUMAN) {
        const nextN = (await maxAttemptNo(lead.id)) + 1;

        if (nextN <= 3) {
          const nextAt = computeNextRetry(nextN, { inVoicemail });
          await supa
            .from('leads')
            .update({ status: 'no_answer', next_retry_at: nextAt })
            .eq('id', lead.id);
        } else {
          // Fallback to WhatsApp outreach asking preferred channel
          await supa
            .from('leads')
            .update({
              status: 'whatsapp_outreach',
              preferred_channel: 'whatsapp',
              next_retry_at: null
            })
            .eq('id', lead.id);
        }
      } else if (DIVERGENT) {
        await supa.from('leads').update({ status: 'divergent' }).eq('id', lead.id);
      } else {
        // Any other successful human conversation path you consider "qualified"
        await supa.from('leads').update({ status: 'qualified' }).eq('id', lead.id);
      }

      return res.sendStatus(200);
    }

    if (type === 'call_analyzed') {
      // Save full transcript / analysis if provided
      const transcript =
        c.transcript ||
        evt.transcript ||
        (Array.isArray(c.transcript_object) ? JSON.stringify(c.transcript_object) : null);
      await supa
        .from('call_attempts')
        .update({ transcript })
        .eq('id', attempt.id);
      return res.sendStatus(200);
    }

    // Unknown event type – ack
    return res.sendStatus(200);
  } catch (e) {
    log.error('retell webhook error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'retell webhook error' });
  }
});

export default r;

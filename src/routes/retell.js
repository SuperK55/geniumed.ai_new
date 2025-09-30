import { Router } from 'express';
import { verifyRetell } from '../middleware/verifyRetell.js';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { Retell } from 'retell-sdk';
import { env } from '../config/env.js';

const r = Router();
// const nextRetryAt = () => { const n=new Date(); n.setHours(n.getHours()+4); return n.toISOString(); };

async function computeNextRetry(attemptNo, { inVoicemail = false, leadId = null } = {}) {
  const now = new Date();

  // If voicemail, try again soon (15–25 min) to catch them shortly after
  if (inVoicemail) {
    const minutes = 15 + Math.floor(Math.random() * 11); // 15..25
    const d = new Date(now.getTime() + minutes * 60 * 1000);
    return d.toISOString();
  }

  // Get appointment information for this lead if leadId is provided
  let appointmentTime = null;
  if (leadId) {
    try {
      const { data: appointments } = await supa
        .from('appointments')
        .select('start_at')
        .eq('lead_id', leadId)
        .gte('start_at', now.toISOString()) // Only future appointments
        .order('start_at', { ascending: true })
        .limit(1);
      
      if (appointments && appointments.length > 0) {
        appointmentTime = new Date(appointments[0].start_at);
      }
    } catch (error) {
      // If there's an error querying appointments, continue with original logic
      console.error('Error querying appointments:', error);
    }
  }

  // Calculate next available time slot (Monday to Saturday, 8 AM to 8 PM)
  const calculateNextSlot = (fromTime) => {
    const d = new Date(fromTime);
    const currentHour = d.getHours();
    const currentMinute = d.getMinutes();
    const currentDay = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // Add 2 hours to current time
    d.setTime(d.getTime() + 2 * 60 * 60 * 1000);
    
    // Check if the new time is within business hours (8 AM to 8 PM)
    if (d.getHours() >= 8 && d.getHours() < 20) {
      // Check if it's a valid day (Monday to Saturday)
      if (d.getDay() >= 1 && d.getDay() <= 6) {
        return d;
      } else {
        // If it's Sunday, move to Monday 8 AM
        const daysUntilMonday = 8 - d.getDay(); // 8 - 0 = 8 days
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(8, 0, 0, 0);
        return d;
      }
    } else {
      // If outside business hours, move to next business day 8 AM
      if (d.getHours() >= 20) {
        // If it's after 8 PM, move to next day
        d.setDate(d.getDate() + 1);
      }
      
      // Find next valid business day (Monday to Saturday)
      while (d.getDay() === 0) { // Skip Sundays
        d.setDate(d.getDate() + 1);
      }
      
      d.setHours(8, 0, 0, 0);
      return d;
    }
  };
  
  let nextRetryTime = calculateNextSlot(now);
  
  // If there's an appointment, check if we need to adjust the retry time
  if (appointmentTime) {
    const timeDiffMs = Math.abs(appointmentTime.getTime() - nextRetryTime.getTime());
    const timeDiffHours = timeDiffMs / (1000 * 60 * 60);
    
    // If the difference between next retry time and appointment is less than 2 hours,
    // move to the next available slot
    if (timeDiffHours < 2) {
      // Move to next business day 8 AM
      nextRetryTime.setDate(nextRetryTime.getDate() + 1);
      
      // Find next valid business day (Monday to Saturday)
      while (nextRetryTime.getDay() === 0) { // Skip Sundays
        nextRetryTime.setDate(nextRetryTime.getDate() + 1);
      }
      
      nextRetryTime.setHours(8, 0, 0, 0);
    }
  }
  
  return nextRetryTime.toISOString();
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

    log.info('retell evt', evt || 'no evt');

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
      const inVoicemail = c.disconnection_reason === 'voicemail_reached';

      const NO_HUMAN =
        inVoicemail ||
        /(no ?answer|no[_-]?pickup|didn'?t pick|missed|timeout|busy|failed|cancelled|declined|unreachable|voicemail_reached)/i.test(
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

      if (inVoicemail) {
        const nextN = (await maxAttemptNo(lead.id)) + 1;

        if (nextN <= 3) {
          const nextAt = await computeNextRetry(nextN, { inVoicemail, leadId: lead.id });
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
      const call_analysis = c.call_analysis || null;
      const total_call_duration = c.call_cost.total_duration_seconds || null;

      console.log('call_analysis', call_analysis, 'total_call_duration', total_call_duration);
      await supa
        .from('call_attempts')
        .update({ transcript, call_analysis, total_call_duration })
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

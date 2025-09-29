import cron from 'node-cron';
import { supa } from './lib/supabase.js';
import { agentManager } from './services/agentManager.js';
import { log } from './config/logger.js';
import { twilio } from './lib/twilio.js';

// Helper function to check if current time is within business hours
function isWithinBusinessHours() {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const currentHour = now.getHours();
  
  // Business hours: Monday to Saturday, 8 AM to 8 PM
  return currentDay >= 1 && currentDay <= 6 && currentHour >= 8 && currentHour < 20;
}

// Helper function to check if enough time has passed since last attempt
async function canRetryNow(leadId, minGapHours = 2) {
  const { data: lastAttempt } = await supa
    .from('call_attempts')
    .select('started_at')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false })
    .limit(1);
  
  if (!lastAttempt?.[0]?.started_at) {
    return true; // No previous attempts
  }
  
  const lastAttemptTime = new Date(lastAttempt[0].started_at);
  const now = new Date();
  const hoursSinceLastAttempt = (now - lastAttemptTime) / (1000 * 60 * 60);
  
  return hoursSinceLastAttempt >= minGapHours;
}

// Helper function to prevent duplicate retry attempts
async function isLeadAlreadyBeingProcessed(leadId) {
  const { data: existingCall } = await supa
    .from('call_attempts')
    .select('id')
    .eq('lead_id', leadId)
    .eq('outcome', 'initiated')
    .is('ended_at', null)
    .limit(1);
  
  return existingCall && existingCall.length > 0;
}

cron.schedule('*/10 * * * *', async () => {
  try {
    const nowIso = new Date().toISOString();
    
    // Skip if outside business hours
    if (!isWithinBusinessHours()) {
      log.info('Skipping retry scheduler - outside business hours');
      return;
    }
    
    // Get leads ready for retry
    const { data: leads, error } = await supa
      .from('leads')
      .select('*')
      .lte('next_retry_at', nowIso)
      .in('status', ['no_answer', 'reschedule', 'call_failed'])
      .not('assigned_agent_id', 'is', null); // Only process leads with assigned agents
    
    if (error) {
      log.error('Error querying leads for retry:', error.message);
      return;
    }
    
    if (!leads || leads.length === 0) {
      return;
    }
    
    
    for (const lead of leads) {
      try {
        // Check if lead is already being processed
        if (await isLeadAlreadyBeingProcessed(lead.id)) {
          log.info(`Lead ${lead.id} already has an active call attempt, skipping`);
          continue;
        }
        
        // Get current attempt count
        const { data: attempts } = await supa
          .from('call_attempts')
          .select('attempt_no, started_at')
          .eq('lead_id', lead.id)
          .order('attempt_no', { ascending: false })
          .limit(1);
        
        const lastAttemptNo = attempts?.[0]?.attempt_no || 0;
        const nextAttemptNo = lastAttemptNo + 1;
        
        // Check max attempts
        if (nextAttemptNo > (lead.max_attempts || 3)) {
          log.info(`Lead ${lead.id} has reached max attempts (${lead.max_attempts || 3}), switching to WhatsApp`);
          await supa
            .from('leads')
            .update({ 
              status: 'whatsapp_outreach', 
              preferred_channel: 'whatsapp',
              next_retry_at: null 
            })
            .eq('id', lead.id);
          continue;
        }
        
        // Check if enough time has passed since last attempt
        if (!(await canRetryNow(lead.id, 2))) {
          log.info(`Lead ${lead.id} - not enough time passed since last attempt, skipping`);
          continue;
        }
        
        // Ensure lead has an assigned agent
        if (!lead.assigned_agent_id) {
          log.info(`Lead ${lead.id} has no assigned agent, attempting to assign...`);
          try {
            const assignment = await agentManager.findDoctorAndAgentForLead(lead);
            const updatedLead = await agentManager.assignDoctorAndAgentToLead(
              lead.id,
              assignment.doctor,
              assignment.agent
            );
            lead.assigned_agent_id = assignment.agent.id;
            lead.assigned_doctor_id = assignment.doctor.id;
            lead.agent_variables = updatedLead.agent_variables;
            log.info(`Lead ${lead.id} assigned to agent ${assignment.agent.id}`);
          } catch (assignmentError) {
            log.error(`Failed to assign doctor/agent for lead ${lead.id}:`, assignmentError.message);
            continue;
          }
        }
        
        // Make the retry call
        const callResponse = await agentManager.makeOutboundCall(lead);
        
        // Record the call attempt
        await supa.from('call_attempts').insert({
          lead_id: lead.id,
          doctor_id: lead.assigned_doctor_id,
          agent_id: lead.assigned_agent_id,
          owner_id: lead.owner_id,
          direction: 'outbound',
          attempt_no: nextAttemptNo,
          scheduled_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          retell_call_id: callResponse.call_id,
          outcome: 'initiated'
        });
        
        // Update lead status
        await supa.from('leads')
          .update({ 
            status: 'calling', 
            next_retry_at: null 
          })
          .eq('id', lead.id);
        
        log.info(`Retry call initiated for lead ${lead.id}: ${callResponse.call_id}`);
        
      } catch (leadError) {
        log.error(`Error processing retry for lead ${lead.id}:`, leadError.message);
        
        // Update lead status to indicate retry failure
        await supa
          .from('leads')
          .update({ 
            status: 'retry_failed',
            next_retry_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // Retry in 30 minutes
          })
          .eq('id', lead.id);
      }
    }
    
    log.info('Retry scheduler check completed');
    
  } catch (error) {
    log.error('Retry scheduler error:', error.message);
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


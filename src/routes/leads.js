import { Router } from 'express';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { agentManager } from '../services/agentManager.js';

const router = Router();

// Enhanced Lead Submission with Multi-Agent Routing for Business Owner Model
router.post('/lead/submit', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      city,
      specialty,
      reason,
      urgency_level = 1,
      whatsapp,
      preferred_channel = 'call',
      preferred_language = 'Português',
      timezone = 'America/Sao_Paulo',
      // Business routing
      owner_id, // Optional: target specific business owner
      source,
      campaign,
      utm_source,
      utm_medium,
      utm_campaign,
      notes,
      custom_fields = {},
      // Test mode
      test_mode = false
    } = req.body;

    // Validation
    if (!name || !phone) {
      return res.status(400).json({
        ok: false,
        error: 'Name and phone are required'
      });
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');

    // Check for duplicate leads (same phone number in last 24 hours)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // const { data: existingLead } = await supa
    //   .from('leads')
    //   .select('id, name, phone, created_at')
    //   .eq('phone', cleanPhone)
    //   .gte('created_at', yesterday.toISOString())
    //   .order('created_at', { ascending: false })
    //   .limit(1)
    //   .single();

    // if (existingLead) {
    //   log.info(`Duplicate lead detected: ${existingLead.id} for phone ${cleanPhone}`);
    //   return res.status(409).json({
    //     ok: false,
    //     error: 'A lead with this phone number was already submitted recently',
    //     existing_lead_id: existingLead.id
    //   });
    // }

    // Create lead record
    const { data: newLead, error: leadError } = await supa
      .from('leads')
      .insert({
        owner_id, // Can be null if not targeting specific business
        name: name.trim(),
        phone: cleanPhone,
        email: email?.trim(),
        city: city?.trim(),
        specialty: specialty?.trim(),
        reason: reason?.trim(),
        urgency_level: parseInt(urgency_level),
        whatsapp: whatsapp?.trim(),
        preferred_channel,
        preferred_language,
        timezone,
        source,
        campaign,
        utm_source,
        utm_medium,
        utm_campaign,
        notes,
        custom_fields,
        status: 'new',
      })
      .select()
      .single();

    if (leadError) {
      log.error('Lead creation error:', leadError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to create lead'
      });
    }

    log.info(`Lead created: ${newLead.id} - ${name} (${cleanPhone})`);

    try {
      let assignment;
      
      // Find appropriate doctor and agent based on owner_id
      assignment = await agentManager.findDoctorAndAgentForLead(newLead);
      
      // Assign doctor and agent to lead
      const updatedLead = await agentManager.assignDoctorAndAgentToLead(
        newLead.id,
        assignment.doctor,
        assignment.agent
      );


      log.info(`Lead ${newLead.id} assigned to doctor ${assignment.doctor.id} (${assignment.doctor.name}) with agent ${assignment.agent.id}`);

      // Attempt immediate outbound call
      try {
        const callResponse = await agentManager.makeOutboundCall(updatedLead);
        
        // Record call attempt
        await supa
          .from('call_attempts')
          .insert({
            lead_id: newLead.id,
            doctor_id: assignment.doctor.id,
            agent_id: assignment.agent.id,
            owner_id: assignment.doctor.owner_id,
            direction: 'outbound',
            attempt_no: 1,
            scheduled_at: new Date().toISOString(),
            started_at: new Date().toISOString(),
            retell_call_id: callResponse.call_id,
            meta: {
              agent_assignment: {
                doctor_id: assignment.doctor.id,
                doctor_name: assignment.doctor.name,
                doctor_specialty: assignment.doctor.specialty,
                agent_id: assignment.agent.id,
                agent_name: assignment.agent.name,
                business_owner: assignment.doctor.owner_id
              }
            }
          });

        log.info(`Outbound call initiated for lead ${newLead.id}: ${callResponse.call_id}`);

        return res.status(201).json({
          ok: true,
          message: 'Lead submitted successfully and call initiated',
          lead: {
            id: newLead.id,
            name: newLead.name,
            phone: newLead.phone,
            status: newLead.status,
            assigned_to: {
              doctor_name: assignment.doctor.name,
              doctor_specialty: assignment.doctor.specialty,
              agent_name: assignment.agent.name,
              business_owner: assignment.doctor.owner_id
            }
          },
          call: {
            call_id: callResponse.call_id,
            status: 'initiated'
          }
        });

      } catch (callError) {
        log.error(`Failed to initiate call for lead ${newLead.id}:`, callError);
        
        // Update lead status to indicate call failure
        await supa
          .from('leads')
          .update({ 
            status: 'call_failed',
            next_retry_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() // Retry in 15 minutes
          })
          .eq('id', newLead.id);

        return res.status(201).json({
          ok: true,
          message: 'Lead submitted successfully but call initiation failed',
          lead: {
            id: newLead.id,
            name: newLead.name,
            phone: newLead.phone,
            status: 'call_failed',
            assigned_to: {
              doctor_name: assignment.doctor.name,
              doctor_specialty: assignment.doctor.specialty,
              agent_name: assignment.agent.name,
              business_owner: assignment.doctor.owner_id
            }
          },
          error: 'Call initiation failed - will retry later'
        });
      }

    } catch (assignmentError) {
      log.error(`Failed to assign doctor/agent for lead ${newLead.id}:`, assignmentError);
      
      // Update lead status to indicate assignment failure
      await supa
        .from('leads')
        .update({ 
          status: 'assignment_failed',
          next_retry_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // Retry in 30 minutes
        })
        .eq('id', newLead.id);

      return res.status(201).json({
        ok: true,
        message: 'Lead submitted but doctor/agent assignment failed',
        lead: {
          id: newLead.id,
          name: newLead.name,
          phone: newLead.phone,
          status: 'assignment_failed'
        },
        error: 'No available doctor/agent for this specialty - will retry later'
      });
    }

  } catch (error) {
    log.error('Lead submission error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Get Lead Status
router.get('/lead/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: lead, error } = await supa
      .from('leads')
      .select(`
        *,
        agents(id, name),
        doctors(id, name, specialty),
        users(id, name),
        call_attempts(
          id,
          attempt_no,
          started_at,
          ended_at,
          outcome,
          disposition,
          retell_call_id,
          duration_seconds
        )
      `)
      .eq('id', id)
      .single();

    if (error || !lead) {
      return res.status(404).json({
        ok: false,
        error: 'Lead not found'
      });
    }

    res.json({
      ok: true,
      lead
    });

  } catch (error) {
    log.error('Lead retrieval error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Get Leads for a Business Owner
router.get('/leads/owner/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { page = 1, limit = 20, status, doctor_id, specialty, source } = req.query;

    const offset = (page - 1) * limit;

    let query = supa
      .from('leads')
      .select(`
        *,
        agents(id, name),
        doctors(id, name, specialty),
        call_attempts(
          id,
          attempt_no,
          started_at,
          ended_at,
          outcome,
          disposition
        )
      `)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (status) query = query.eq('status', status);
    if (doctor_id) query = query.eq('assigned_doctor_id', doctor_id);
    if (specialty) query = query.eq('specialty', specialty);
    if (source) query = query.eq('source', source);

    const { data: leads, error } = await query;

    if (error) {
      log.error('Leads retrieval error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to retrieve leads'
      });
    }

    // Get total count
    let countQuery = supa
      .from('leads')
      .select('id', { count: 'exact' })
      .eq('owner_id', ownerId);

    if (status) countQuery = countQuery.eq('status', status);
    if (doctor_id) countQuery = countQuery.eq('assigned_doctor_id', doctor_id);
    if (specialty) countQuery = countQuery.eq('specialty', specialty);
    if (source) countQuery = countQuery.eq('source', source);

    const { count } = await countQuery;

    res.json({
      ok: true,
      leads: leads || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    log.error('Owner leads retrieval error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Get Leads for a Specific Doctor
router.get('/leads/doctor/:doctorId', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { page = 1, limit = 20, status } = req.query;

    const offset = (page - 1) * limit;

    let query = supa
      .from('leads')
      .select(`
        *,
        agents(id, name),
        call_attempts(
          id,
          attempt_no,
          started_at,
          ended_at,
          outcome,
          disposition
        )
      `)
      .eq('assigned_doctor_id', doctorId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: leads, error } = await query;

    if (error) {
      log.error('Doctor leads retrieval error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to retrieve leads'
      });
    }

    // Get total count
    let countQuery = supa
      .from('leads')
      .select('id', { count: 'exact' })
      .eq('assigned_doctor_id', doctorId);

    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    const { count } = await countQuery;

    res.json({
      ok: true,
      leads: leads || [],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    log.error('Doctor leads retrieval error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Retry Lead Call
router.post('/lead/:id/retry', async (req, res) => {
  try {
    const { id } = req.params;

    // Get lead with assignment
    const { data: lead, error: leadError } = await supa
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();

    if (leadError || !lead) {
      return res.status(404).json({
        ok: false,
        error: 'Lead not found'
      });
    }

    if (!lead.assigned_agent_id || !lead.assigned_doctor_id) {
      // Try to assign doctor and agent first
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
      } catch (assignmentError) {
        return res.status(400).json({
          ok: false,
          error: 'No available doctor/agent for this lead'
        });
      }
    }

    // Get current attempt number
    const { data: attempts } = await supa
      .from('call_attempts')
      .select('attempt_no')
      .eq('lead_id', id)
      .order('attempt_no', { ascending: false })
      .limit(1);

    const nextAttemptNo = (attempts?.[0]?.attempt_no || 0) + 1;

    if (nextAttemptNo > (lead.max_attempts || 3)) {
      return res.status(400).json({
        ok: false,
        error: 'Maximum retry attempts reached'
      });
    }

    // Make the call
    try {
      const callResponse = await agentManager.makeOutboundCall(lead);
      
      // Record call attempt
      await supa
        .from('call_attempts')
        .insert({
          lead_id: id,
          doctor_id: lead.assigned_doctor_id,
          agent_id: lead.assigned_agent_id,
          owner_id: lead.owner_id,
          direction: 'outbound',
          attempt_no: nextAttemptNo,
          scheduled_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          retell_call_id: callResponse.call_id
        });

      // Update lead status
      await supa
        .from('leads')
        .update({ 
          status: 'calling',
          next_retry_at: null
        })
        .eq('id', id);

      res.json({
        ok: true,
        message: 'Retry call initiated successfully',
        call: {
          call_id: callResponse.call_id,
          attempt_no: nextAttemptNo
        }
      });

    } catch (callError) {
      log.error(`Retry call failed for lead ${id}:`, callError);
      res.status(500).json({
        ok: false,
        error: 'Failed to initiate retry call'
      });
    }

  } catch (error) {
    log.error('Lead retry error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Update Lead
router.put('/lead/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove sensitive fields that shouldn't be updated directly
    delete updates.id;
    delete updates.owner_id;
    delete updates.created_at;

    // Update lead
    const { data: updatedLead, error } = await supa
      .from('leads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      log.error('Lead update error:', error);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update lead'
      });
    }

    if (!updatedLead) {
      return res.status(404).json({
        ok: false,
        error: 'Lead not found'
      });
    }

    res.json({
      ok: true,
      message: 'Lead updated successfully',
      lead: updatedLead
    });

  } catch (error) {
    log.error('Lead update error:', error);
    res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

// Lead Analytics for Business Owner
router.get('/analytics/leads/:ownerId', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { timeframe = '30d' } = req.query;

    // Calculate date filter
    let dateFilter = new Date();
    switch (timeframe) {
      case '7d':
        dateFilter.setDate(dateFilter.getDate() - 7);
        break;
      case '30d':
        dateFilter.setDate(dateFilter.getDate() - 30);
        break;
      case '90d':
        dateFilter.setDate(dateFilter.getDate() - 90);
        break;
      default:
        dateFilter.setDate(dateFilter.getDate() - 30);
    }

    // Get leads for the timeframe
    const { data: leads, error } = await supa
      .from('leads')
      .select(`
        *,
        call_attempts(outcome, disposition)
      `)
      .eq('owner_id', ownerId)
      .gte('created_at', dateFilter.toISOString());

    if (error) {
      throw error;
    }

    // Calculate analytics
    const analytics = {
      total_leads: leads?.length || 0,
      by_status: {},
      by_specialty: {},
      by_source: {},
      by_outcome: {},
      conversion_rate: 0,
      average_response_time: 0
    };

    // Group data
    leads?.forEach(lead => {
      // By status
      analytics.by_status[lead.status] = (analytics.by_status[lead.status] || 0) + 1;
      
      // By specialty
      if (lead.specialty) {
        analytics.by_specialty[lead.specialty] = (analytics.by_specialty[lead.specialty] || 0) + 1;
      }
      
      // By source
      if (lead.source) {
        analytics.by_source[lead.source] = (analytics.by_source[lead.source] || 0) + 1;
      }

      // By call outcomes
      lead.call_attempts?.forEach(attempt => {
        if (attempt.outcome) {
          analytics.by_outcome[attempt.outcome] = (analytics.by_outcome[attempt.outcome] || 0) + 1;
        }
      });
    });

    // Calculate conversion rate (completed calls / total leads)
    const completedCalls = analytics.by_outcome.completed || 0;
    analytics.conversion_rate = analytics.total_leads > 0 
      ? Math.round((completedCalls / analytics.total_leads) * 100) 
      : 0;

    res.json({
      ok: true,
      analytics,
      timeframe
    });

  } catch (error) {
    log.error('Lead analytics error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch lead analytics'
    });
  }
});

export default router; 
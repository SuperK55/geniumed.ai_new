import { Router } from 'express';
import { verifyJWT } from '../middleware/verifyJWT.js';
import { supa } from '../lib/supabase.js';
import { log } from '../config/logger.js';
import { retellDeleteAgent } from '../lib/retell.js';
import Retell from 'retell-sdk';
import { env } from '../config/env.js';
import { agentManager } from '../services/agentManager.js';

const client = new Retell({ apiKey: env.RETELL_API_KEY });

const router = Router();

// Create a new agent
router.post('/', verifyJWT, async (req, res) => {
  try {
    const agentData = req.body;

    const newAgent = await agentManager.createAgentForOwner(req.user.id, agentData);

    res.status(201).json({
      ok: true,
      message: 'Agent created successfully',
      agent: {
        id: newAgent.id,
        agent_name: newAgent.agent_name,
        language: newAgent.language,
        voice_id: newAgent.voice_id,
        is_active: newAgent.is_active,
        // Additional conversation control fields
        agent_role: newAgent.agent_role,
        service_description: newAgent.service_description,
        assistant_name: newAgent.assistant_name,
        script: newAgent.script,
        created_at: newAgent.created_at,
        updated_at: newAgent.updated_at
      }
    });

  } catch (error) {
    log.error('Create agent error:', error);
    
    if (error.message.includes('required')) {
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    res.status(500).json({
      ok: false,
      error: 'Failed to create agent'
    });
  }
});

// Get statistics for voice agents
router.get('/get/stats', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get all agents for the user
    const { data: agents, error: agentsError } = await supa
      .from('agents')
      .select('*')
      .eq('owner_id', userId);

    if (agentsError) {
      throw new Error(agentsError.message);
    }

    // Calculate active agents (published and active)
    const activeAgents = agents?.filter(agent => agent.is_active) || [];
    
    // Get today's date for filtering calls
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Get real call statistics from call_attempts table
    let totalCallsToday = 0;
    let successfulCalls = 0;
    let totalAgentHours = 0;
    let callsTrend = 0;
    let successTrend = 0;

    if (activeAgents.length > 0) {
      const agentIds = activeAgents.map(a => a.id);
      
      // Get today's call attempts
      const { data: todayCalls, error: todayCallsError } = await supa
        .from('call_attempts')
        .select('*')
        .in('agent_id', agentIds)
        .gte('started_at', todayStart.toISOString())
        .lt('started_at', todayEnd.toISOString());

      if (!todayCallsError && todayCalls) {
        totalCallsToday = todayCalls.length;
        
        // Count successful calls (completed, qualified, or any positive outcome)
        successfulCalls = todayCalls.filter(call => 
          call.outcome === 'completed' || 
          call.outcome === 'qualified' ||
          call.disposition === 'interested' ||
          call.disposition === 'scheduled'
        ).length;
        
        // Calculate total agent hours based on call durations
        totalAgentHours = todayCalls.reduce((total, call) => {
          const duration = call.total_call_duration || call.total_duration_seconds || call.duration_seconds;
          if (duration) {
            return total + (duration / 3600); // Convert seconds to hours
          }
          return total;
        }, 0);
      }

      // Get yesterday's data for trend calculation
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayEnd = new Date(todayEnd);
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

      const { data: yesterdayCalls, error: yesterdayCallsError } = await supa
        .from('call_attempts')
        .select('*')
        .in('agent_id', agentIds)
        .gte('started_at', yesterdayStart.toISOString())
        .lt('started_at', yesterdayEnd.toISOString());

      if (!yesterdayCallsError && yesterdayCalls) {
        const yesterdayTotalCalls = yesterdayCalls.length;
        const yesterdaySuccessfulCalls = yesterdayCalls.filter(call => 
          call.outcome === 'completed' || 
          call.outcome === 'qualified' ||
          call.disposition === 'interested' ||
          call.disposition === 'scheduled'
        ).length;
        
        const yesterdaySuccessRate = yesterdayTotalCalls > 0 ? (yesterdaySuccessfulCalls / yesterdayTotalCalls) * 100 : 0;
        const todaySuccessRate = totalCallsToday > 0 ? (successfulCalls / totalCallsToday) * 100 : 0;
        
        // Calculate trends
        callsTrend = yesterdayTotalCalls > 0 ? Math.round(((totalCallsToday - yesterdayTotalCalls) / yesterdayTotalCalls) * 100) : 0;
        successTrend = Math.round(todaySuccessRate - yesterdaySuccessRate);
      }
    }

    const successRate = totalCallsToday > 0 ? Math.round((successfulCalls / totalCallsToday) * 100) : 0;

    // Get real recent activity from call_attempts
    let recentActivity = [];
    
    if (activeAgents.length > 0) {
      const agentIds = activeAgents.map(a => a.id);
      
      // Get recent call attempts (last 24 hours)
      const recentStart = new Date();
      recentStart.setHours(recentStart.getHours() - 24);
      
      const { data: recentCalls, error: recentCallsError } = await supa
        .from('call_attempts')
        .select(`
          *,
          leads!inner(name, phone),
          agents!inner(agent_name, agent_role)
        `)
        .in('agent_id', agentIds)
        .gte('started_at', recentStart.toISOString())
        .order('started_at', { ascending: false })
        .limit(10);

      if (!recentCallsError && recentCalls) {
        recentActivity = recentCalls.map(call => {
          const now = new Date();
          const callTime = new Date(call.started_at);
          const minutesAgo = Math.floor((now - callTime) / (1000 * 60));
          
          // Determine activity type and status based on outcome
          let activityType = 'call';
          let status = 'success';
          let title = `Call with ${call.leads.name}`;
          
          if (call.outcome === 'completed' || call.outcome === 'qualified') {
            activityType = 'completed';
            title = `Completed call with ${call.leads.name}`;
          } else if (call.outcome === 'no_answer' || call.outcome === 'voicemail') {
            activityType = 'failed';
            status = 'error';
            title = `No answer from ${call.leads.name}`;
          } else if (call.disposition === 'scheduled') {
            activityType = 'appointment';
            title = `Scheduled appointment for ${call.leads.name}`;
          } else if (call.disposition === 'interested') {
            activityType = 'interested';
            title = `Qualified lead: ${call.leads.name}`;
          }
          
          // Format duration
          const callDuration = call.total_call_duration || call.total_duration_seconds || call.duration_seconds;
          const duration = callDuration ? 
            `${Math.floor(callDuration / 60)}:${String(callDuration % 60).padStart(2, '0')}` : 
            '0:00';
          
          return {
            id: call.id,
            type: activityType,
            status: status,
            title: title,
            agentType: call.agents.agent_name || 'Voice Agent',
            duration: duration,
            timeAgo: minutesAgo < 60 ? 
              `${minutesAgo} minute${minutesAgo !== 1 ? 's' : ''} ago` :
              `${Math.floor(minutesAgo / 60)} hour${Math.floor(minutesAgo / 60) !== 1 ? 's' : ''} ago`
          };
        });
      }
    }

    const stats = {
      activeAgents: activeAgents.length,
      totalAgents: agents?.length || 0,
      totalCallsToday,
      successRate: `${successRate}%`,
      totalAgentHours: `${totalAgentHours.toFixed(1)}h`,
      trends: {
        calls: {
          value: Math.abs(callsTrend),
          isPositive: callsTrend >= 0
        },
        successRate: {
          value: Math.abs(successTrend),
          isPositive: successTrend >= 0
        }
      },
      recentActivity
    };

    res.json({ stats });
  } catch (error) {
    log.error('Error fetching agent stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all agents for the authenticated user
router.get('/', verifyJWT, async (req, res) => {
  try {
    const { data: agents, error } = await supa
      .from('agents')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    res.json({ agents: agents || [] });
  } catch (error) {
    log.error('Error fetching agents:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set default agent for user
router.put('/default/:agentId', verifyJWT, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.id;

    // Verify the agent belongs to the user and get user's phone number
    const { data: agent, error: agentError } = await supa
      .from('agents')
      .select(`
        id, 
        agent_name, 
        is_active,
        retell_agent_id,
        users!agents_owner_id_fkey(phone_number)
      `)
      .eq('id', agentId)
      .eq('owner_id', userId)
      .single();

    if (agentError || !agent) {
      return res.status(404).json({ error: 'Agent not found or not owned by user' });
    }

    if (!agent.is_active) {
      return res.status(400).json({ error: 'Cannot set inactive agent as default' });
    }

    // Update user's default agent
    const { error: updateError } = await supa
      .from('users')
      .update({ default_agent_id: agentId })
      .eq('id', userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // Update Retell agent configuration with user's phone number if available
    if (agent.retell_agent_id && agent.users?.phone_number) {
      try {
        await client.phoneNumber.update( agent.users.phone_number, {
          inbound_agent_id: agent.retell_agent_id,
          outbound_agent_id: agent.retell_agent_id,
        })
        log.info(`Updated Retell agent ${agent.retell_agent_id} with phone number ${agent.users.phone_number}`);
      } catch (retellError) {
        log.warn(`Failed to update Retell agent with phone number: ${retellError.message}`);
        // Don't fail the request if Retell update fails
      }
    }

    log.info(`User ${userId} set default agent to ${agentId} (${agent.agent_name})`);

    res.json({
      success: true,
      message: 'Default agent updated successfully',
      defaultAgent: {
        id: agent.id,
        name: agent.agent_name
      }
    });

  } catch (error) {
    log.error('Error setting default agent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get default agent for user
router.get('/get/default', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's default agent
    const { data: user, error: userError } = await supa
      .from('users')
      .select('default_agent_id')
      .eq('id', userId)
      .single();

    if (userError) {
      throw new Error(userError.message);
    }

    if (!user.default_agent_id) {
      return res.json({
        success: true,
        defaultAgent: null,
        message: 'No default agent set'
      });
    }

    // Get default agent details
    const { data: agent, error: agentError } = await supa
      .from('agents')
      .select('id, agent_name, agent_role, is_active')
      .eq('id', user.default_agent_id)
      .eq('owner_id', userId)
      .single();

    if (agentError || !agent) {
      // Default agent was deleted or doesn't belong to user, clear it
      await supa
        .from('users')
        .update({ default_agent_id: null })
        .eq('id', userId);

      return res.json({
        success: true,
        defaultAgent: null,
        message: 'Default agent was invalid and has been cleared'
      });
    }

    res.json({
      success: true,
      defaultAgent: {
        id: agent.id,
        name: agent.agent_name,
        role: agent.agent_role,
        isActive: agent.is_active
      }
    });

  } catch (error) {
    log.error('Error getting default agent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove default agent
router.delete('/default', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;

    const { error: updateError } = await supa
      .from('users')
      .update({ default_agent_id: null })
      .eq('id', userId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    log.info(`User ${userId} removed default agent`);

    res.json({
      success: true,
      message: 'Default agent removed successfully'
    });

  } catch (error) {
    log.error('Error removing default agent:', error);
    res.status(500).json({ error: error.message });
  }
});


// Update an agent
router.patch('/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // First get the current agent to check if it has a retell_agent_id
    const { data: currentAgent, error: fetchError } = await supa
      .from('agents')
      .select('retell_agent_id')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .single();

    if (fetchError || !currentAgent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Update Retell agent if retell_agent_id exists
    // if (currentAgent.retell_agent_id) {
    //   try {
    //     await client.agent.update(currentAgent.retell_agent_id, {
    //       agent_name: updateData.agent_name,
    //       // Add other fields that should be updated in Retell
    //       ...(updateData.conversation_flow && {
    //         conversation_flow: updateData.conversation_flow
    //       })
    //     });
    //     log.info(`Retell agent updated: ${currentAgent.retell_agent_id}`);
    //   } catch (retellError) {
    //     log.error('Error updating Retell agent:', retellError);
    //     // Continue with database update even if Retell update fails
    //   }
    // }

    const { data: agent, error } = await supa
      .from('agents')
      .update(updateData)
      .eq('id', id)
      .eq('owner_id', req.user.id) // Ensure user owns the agent
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({ agent });
  } catch (error) {
    log.error('Error updating agent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an agent
router.delete('/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;

    // First, get the agent to check ownership and get retell_agent_id
    const { data: agent, error: fetchError } = await supa
      .from('agents')
      .select('retell_agent_id')
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .single();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Handle foreign key constraints - reassign or delete associated data
    try {
      // First, check if there are any leads assigned to this agent
      const { data: assignedLeads, error: leadsError } = await supa
        .from('leads')
        .select('id')
        .eq('assigned_agent_id', id);

      if (leadsError) {
        log.error('Error checking assigned leads:', leadsError);
      } else if (assignedLeads && assignedLeads.length > 0) {
        // Reassign leads to null (unassigned) or delete them
        // For now, we'll unassign them by setting assigned_agent_id to null
        const { error: updateLeadsError } = await supa
          .from('leads')
          .update({ assigned_agent_id: null })
          .eq('assigned_agent_id', id);

        if (updateLeadsError) {
          log.error('Error unassigning leads:', updateLeadsError);
          throw new Error('Cannot delete agent: Failed to unassign associated leads');
        }
        
        log.info(`Unassigned ${assignedLeads.length} leads from agent ${id}`);
      }

      // Check if there are any call attempts associated with this agent
      const { data: callAttempts, error: callAttemptsError } = await supa
        .from('call_attempts')
        .select('id')
        .eq('agent_id', id);

      if (callAttemptsError) {
        log.error('Error checking call attempts:', callAttemptsError);
      } else if (callAttempts && callAttempts.length > 0) {
        // Delete call attempts associated with this agent
        const { error: deleteCallAttemptsError } = await supa
          .from('call_attempts')
          .delete()
          .eq('agent_id', id);

        if (deleteCallAttemptsError) {
          log.error('Error deleting call attempts:', deleteCallAttemptsError);
          throw new Error('Cannot delete agent: Failed to delete associated call attempts');
        }
        
        log.info(`Deleted ${callAttempts.length} call attempts for agent ${id}`);
      }

        // Check if this agent is set as default_agent_id for any user
      const { data: usersWithDefaultAgent, error: usersError } = await supa
        .from('users')
        .select('id')
        .eq('default_agent_id', id);

      if (usersError) {
        log.error('Error checking users with default agent:', usersError);
      } else if (usersWithDefaultAgent && usersWithDefaultAgent.length > 0) {
        // Remove this agent as the default agent for all users
        const { error: updateUsersError } = await supa
          .from('users')
          .update({ default_agent_id: null })
          .eq('default_agent_id', id);

        if (updateUsersError) {
          log.error('Error updating users default agent:', updateUsersError);
          throw new Error('Cannot delete agent: Failed to update users with this agent as default');
        }
        
        log.info(`Removed agent ${id} as default agent for ${usersWithDefaultAgent.length} users`);
      }
    } catch (constraintError) {
      log.error('Error handling foreign key constraints:', constraintError);
      throw new Error('Cannot delete agent: Agent has associated data that cannot be removed');
    }

    // Delete from Retell AI if retell_agent_id exists
    if (agent.retell_agent_id) {
      try {
        await retellDeleteAgent(agent.retell_agent_id);
        log.info(`Retell agent ${agent.retell_agent_id} deleted successfully`);
      } catch (retellError) {
        log.error('Error deleting Retell agent:', retellError);
        // Continue with database deletion even if Retell deletion fails
      }
    }

    // Delete from database
    const { error: deleteError } = await supa
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('owner_id', req.user.id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    res.status(204).send();
  } catch (error) {
    log.error('Error deleting agent:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get call logs for user
router.get('/call-logs', verifyJWT, async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, status, agent_id, date_from, date_to } = req.query;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Build query conditions
    let query = supa
      .from('call_attempts')
      .select(`
        *,
        leads!inner(name, phone, city, specialty),
        agents!inner(agent_name, agent_role),
        doctors!inner(name, specialty)
      `)
      .eq('owner_id', userId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    // Apply filters
    if (status) {
      query = query.eq('outcome', status);
    }
    
    if (agent_id) {
      query = query.eq('agent_id', agent_id);
    }
    
    if (date_from) {
      query = query.gte('started_at', date_from);
    }
    
    if (date_to) {
      query = query.lte('started_at', date_to);
    }
    
    const { data: callLogs, error } = await query;
    
    if (error) {
      throw new Error(error.message);
    }
    
    // Get total count for pagination
    let countQuery = supa
      .from('call_attempts')
      .select('id', { count: 'exact' })
      .eq('owner_id', userId);
    
    if (status) {
      countQuery = countQuery.eq('outcome', status);
    }
    
    if (agent_id) {
      countQuery = countQuery.eq('agent_id', agent_id);
    }
    
    if (date_from) {
      countQuery = countQuery.gte('started_at', date_from);
    }
    
    if (date_to) {
      countQuery = countQuery.lte('started_at', date_to);
    }
    
    const { count, error: countError } = await countQuery;
    
    if (countError) {
      throw new Error(countError.message);
    }
    
    // Format the response
    const formattedLogs = callLogs.map(log => ({
      id: log.id,
      callId: log.retell_call_id,
      leadName: log.leads.name,
      leadPhone: log.leads.phone,
      leadCity: log.leads.city,
      leadSpecialty: log.leads.specialty,
      agentName: log.agents.agent_name,
      agentRole: log.agents.agent_role,
      doctorName: log.doctors.name,
      doctorSpecialty: log.doctors.specialty,
      outcome: log.outcome,
      disposition: log.disposition,
      attemptNo: log.attempt_no,
      startedAt: log.started_at,
      endedAt: log.ended_at,
      duration: log.total_call_duration || log.total_duration_seconds || log.duration_seconds || 0,








      
      transcript: log.transcript,
      summary: log.summary,
      callAnalysis: log.call_analysis
    }));
    
    res.json({
      success: true,
      data: formattedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit)
      }
    });
    
  } catch (error) {
    log.error('Error fetching call logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get call log details
router.get('/call-logs/:id', verifyJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    const { data: callLog, error } = await supa
      .from('call_attempts')
      .select(`
        *,
        leads!inner(name, phone, city, specialty, reason),
        agents!inner(agent_name, agent_role),
        doctors!inner(name, specialty, bio)
      `)
      .eq('id', id)
      .eq('owner_id', userId)
      .single();
    
    if (error || !callLog) {
      return res.status(404).json({ error: 'Call log not found' });
    }
    
    res.json({
      success: true,
      data: {
        id: callLog.id,
        callId: callLog.retell_call_id,
        leadName: callLog.leads.name,
        leadPhone: callLog.leads.phone,
        leadCity: callLog.leads.city,
        leadSpecialty: callLog.leads.specialty,
        leadReason: callLog.leads.reason,
        agentName: callLog.agents.agent_name,
        agentRole: callLog.agents.agent_role,
        doctorName: callLog.doctors.name,
        doctorSpecialty: callLog.doctors.specialty,
        doctorBio: callLog.doctors.bio,
        outcome: callLog.outcome,
        disposition: callLog.disposition,
        attemptNo: callLog.attempt_no,
        startedAt: callLog.started_at,
        endedAt: callLog.ended_at,
        duration: callLog.total_call_duration || callLog.total_duration_seconds || callLog.duration_seconds || 0,
        transcript: callLog.transcript,
        summary: callLog.summary,
        callAnalysis: callLog.call_analysis,
        analysis: callLog.analysis,
        meta: callLog.meta
      }
    });
    
  } catch (error) {
    log.error('Error fetching call log details:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

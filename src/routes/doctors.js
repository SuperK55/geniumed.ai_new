import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { supa } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import { agentManager } from '../services/agentManager.js';

const router = Router();
const JWT_SECRET = env.JWT_SECRET || 'geniumed-secret-key-change-in-production';

// Middleware to authenticate and get owner ID
const authenticateOwner = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user exists and is active
    const { data: user, error } = await supa
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({
        ok: false,
        error: 'Invalid token'
      });
    }

    // Check if user is active (if column exists)
    if (user.is_active === false) {
      return res.status(401).json({
        ok: false,
        error: 'User account is inactive'
      });
    }

    req.ownerId = user.id;
    req.ownerRole = user.role;
    req.businessName = user.name; // Use name instead of business_name
    next();

  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: 'Invalid token'
    });
  }
};

// Get all doctors for the business owner
router.get('/doctors', authenticateOwner, async (req, res) => {
  try {
    const { active_only = true } = req.query;
    
    const doctors = await agentManager.getDoctorsForOwner(req.ownerId, {
      activeOnly: active_only === 'true'
    });

    res.json({
      ok: true,
      doctors
    });

  } catch (error) {
    log.error('Get doctors error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch doctors'
    });
  }
});

// Get a specific doctor by ID
router.get('/doctors/:doctorId', authenticateOwner, async (req, res) => {
  try {
    const { doctorId } = req.params;

    const { data: doctor, error } = await supa
      .from('doctors')
      .select('*')
      .eq('id', doctorId)
      .eq('owner_id', req.ownerId)
      .single();

    if (error || !doctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found'
      });
    }

    res.json({
      ok: true,
      doctor
    });

  } catch (error) {
    log.error('Get doctor error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch doctor'
    });
  }
});

// Create a new doctor
router.post('/doctors', authenticateOwner, async (req, res) => {
  try {
    const doctorData = req.body;

    // Add owner_id to the doctor data
    doctorData.owner_id = req.ownerId;

    const newDoctor = await agentManager.createDoctor(req.ownerId, doctorData);

    res.status(201).json({
      ok: true,
      message: 'Doctor created successfully',
      doctor: newDoctor
    });

  } catch (error) {
    log.error('Create doctor error:', error);
    
    if (error.message.includes('required')) {
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    res.status(500).json({
      ok: false,
      error: 'Failed to create doctor'
    });
  }
});

// Update a doctor
router.put('/doctors/:doctorId', authenticateOwner, async (req, res) => {
  try {
    const { doctorId } = req.params;
    const updates = req.body;

    // Remove owner_id from updates to prevent changing ownership
    delete updates.owner_id;

    // Verify doctor belongs to this owner
    const { data: existingDoctor, error: checkError } = await supa
      .from('doctors')
      .select('id')
      .eq('id', doctorId)
      .eq('owner_id', req.ownerId)
      .single();

    if (checkError || !existingDoctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found'
      });
    }

    // Update doctor
    const { data: updatedDoctor, error: updateError } = await supa
      .from('doctors')
      .update(updates)
      .eq('id', doctorId)
      .select()
      .single();

    if (updateError) {
      log.error('Update doctor error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to update doctor'
      });
    }

    res.json({
      ok: true,
      message: 'Doctor updated successfully',
      doctor: updatedDoctor
    });

  } catch (error) {
    log.error('Update doctor error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update doctor'
    });
  }
});

// Delete (deactivate) a doctor
router.delete('/doctors/:doctorId', authenticateOwner, async (req, res) => {
  try {
    const { doctorId } = req.params;

    // Verify doctor belongs to this owner
    const { data: existingDoctor, error: checkError } = await supa
      .from('doctors')
      .select('id, name')
      .eq('id', doctorId)
      .eq('owner_id', req.ownerId)
      .single();

    if (checkError || !existingDoctor) {
      return res.status(404).json({
        ok: false,
        error: 'Doctor not found'
      });
    }

    // Deactivate doctor
    const { error: doctorError } = await supa
      .from('doctors')
      .update({ is_active: false })
      .eq('id', doctorId);

    if (doctorError) {
      log.error('Deactivate doctor error:', doctorError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to deactivate doctor'
      });
    }

    res.json({
      ok: true,
      message: `Doctor ${existingDoctor.name} deactivated successfully`
    });

  } catch (error) {
    log.error('Delete doctor error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to deactivate doctor'
    });
  }
});

// ========================================
// AGENT MANAGEMENT ROUTES (Owner-Controlled)
// ========================================

// Create a new agent (independent of doctors)
router.post('/agents', authenticateOwner, async (req, res) => {
  try {
    const agentData = req.body;

    const newAgent = await agentManager.createAgentForOwner(req.ownerId, agentData);

    res.status(201).json({
      ok: true,
      message: 'Agent created successfully',
      agent: {
        id: newAgent.id,
        name: newAgent.name,
        description: newAgent.description,
        specialties: newAgent.specialties,
        target_audience: newAgent.target_audience,
        language: newAgent.language,
        voice_id: newAgent.voice_id,
        is_active: newAgent.is_active
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

// Get all agents for the business owner
router.get('/agents', authenticateOwner, async (req, res) => {
  try {
    const { active_only = true } = req.query;
    
    const agents = await agentManager.getAgentsForOwner(req.ownerId, {
      activeOnly: active_only === 'true'
    });

    res.json({
      ok: true,
      agents
    });

  } catch (error) {
    log.error('Get agents error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch agents'
    });
  }
});

// Get a specific agent
router.get('/agents/:agentId', authenticateOwner, async (req, res) => {
  try {
    const { agentId } = req.params;

    const { data: agent, error } = await supa
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('owner_id', req.ownerId)
      .single();

    if (error || !agent) {
      return res.status(404).json({
        ok: false,
        error: 'Agent not found'
      });
    }

    res.json({
      ok: true,
      agent
    });

  } catch (error) {
    log.error('Get agent error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch agent'
    });
  }
});

// Update an agent
router.put('/agents/:agentId', authenticateOwner, async (req, res) => {
  try {
    const { agentId } = req.params;
    const updates = req.body;

    // Remove sensitive fields from updates
    delete updates.owner_id;
    delete updates.retell_agent_id;

    // Verify agent belongs to this owner
    const { data: existingAgent, error: checkError } = await supa
      .from('agents')
      .select('id')
      .eq('id', agentId)
      .eq('owner_id', req.ownerId)
      .single();

    if (checkError || !existingAgent) {
      return res.status(404).json({
        ok: false,
        error: 'Agent not found'
      });
    }

    // Update agent
    const updatedAgent = await agentManager.updateAgent(agentId, updates);

    res.json({
      ok: true,
      message: 'Agent updated successfully',
      agent: updatedAgent
    });

  } catch (error) {
    log.error('Update agent error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update agent'
    });
  }
});

// Delete (deactivate) an agent
router.delete('/agents/:agentId', authenticateOwner, async (req, res) => {
  try {
    const { agentId } = req.params;

    // Verify agent belongs to this owner
    const { data: existingAgent, error: checkError } = await supa
      .from('agents')
      .select('id, name')
      .eq('id', agentId)
      .eq('owner_id', req.ownerId)
      .single();

    if (checkError || !existingAgent) {
      return res.status(404).json({
        ok: false,
        error: 'Agent not found'
      });
    }

    // Deactivate agent
    const { error: updateError } = await supa
      .from('agents')
      .update({ is_active: false })
      .eq('id', agentId);

    if (updateError) {
      log.error('Deactivate agent error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to deactivate agent'
      });
    }

    res.json({
      ok: true,
      message: `Agent ${existingAgent.name} deactivated successfully`
    });

  } catch (error) {
    log.error('Delete agent error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to deactivate agent'
    });
  }
});

// Set default agent for the owner
router.post('/agents/:agentId/set-default', authenticateOwner, async (req, res) => {
  try {
    const { agentId } = req.params;

    await agentManager.setDefaultAgent(req.ownerId, agentId);

    res.json({
      ok: true,
      message: 'Default agent updated successfully'
    });

  } catch (error) {
    log.error('Set default agent error:', error);
    res.status(500).json({
      ok: false,
      error: error.message || 'Failed to set default agent'
    });
  }
});

// Get default agent for the owner
router.get('/agents/default', authenticateOwner, async (req, res) => {
  try {
    const defaultAgent = await agentManager.getDefaultAgent(req.ownerId);

    res.json({
      ok: true,
      default_agent: defaultAgent
    });

  } catch (error) {
    log.error('Get default agent error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch default agent'
    });
  }
});

// Get performance statistics for owner's agents
router.get('/analytics/agents', authenticateOwner, async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    
    const stats = await agentManager.getOwnerAgentStats(req.ownerId, { timeframe });

    res.json({
      ok: true,
      stats,
      timeframe
    });

  } catch (error) {
    log.error('Get agent stats error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch agent statistics'
    });
  }
});

// Get available specialties
router.get('/specialties', authenticateOwner, async (req, res) => {
  try {
    const { data: specialties, error } = await supa
      .from('specialties')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    res.json({
      ok: true,
      specialties: specialties || []
    });

  } catch (error) {
    log.error('Get specialties error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch specialties'
    });
  }
});

// Bulk operations for doctors
router.post('/doctors/bulk-action', authenticateOwner, async (req, res) => {
  try {
    const { action, doctor_ids } = req.body;

    if (!action || !Array.isArray(doctor_ids) || doctor_ids.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Action and doctor_ids array are required'
      });
    }

    // Verify all doctors belong to this owner
    const { data: doctors, error: verifyError } = await supa
      .from('doctors')
      .select('id, name')
      .eq('owner_id', req.ownerId)
      .in('id', doctor_ids);

    if (verifyError || doctors.length !== doctor_ids.length) {
      return res.status(400).json({
        ok: false,
        error: 'Some doctors not found or do not belong to you'
      });
    }

    let updateData = {};
    let message = '';

    switch (action) {
      case 'activate':
        updateData = { is_active: true };
        message = `${doctors.length} doctor(s) activated`;
        break;
      case 'deactivate':
        updateData = { is_active: false };
        message = `${doctors.length} doctor(s) deactivated`;
        break;
      default:
        return res.status(400).json({
          ok: false,
          error: 'Invalid action. Supported actions: activate, deactivate'
        });
    }

    // Perform bulk update
    const { error: updateError } = await supa
      .from('doctors')
      .update(updateData)
      .in('id', doctor_ids);

    if (updateError) {
      log.error('Bulk doctor update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to perform bulk action'
      });
    }

    res.json({
      ok: true,
      message,
      affected_doctors: doctors.length
    });

  } catch (error) {
    log.error('Bulk doctor action error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to perform bulk action'
    });
  }
});

// Bulk operations for agents
router.post('/agents/bulk-action', authenticateOwner, async (req, res) => {
  try {
    const { action, agent_ids } = req.body;

    if (!action || !Array.isArray(agent_ids) || agent_ids.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Action and agent_ids array are required'
      });
    }

    // Verify all agents belong to this owner
    const { data: agents, error: verifyError } = await supa
      .from('agents')
      .select('id, name')
      .eq('owner_id', req.ownerId)
      .in('id', agent_ids);

    if (verifyError || agents.length !== agent_ids.length) {
      return res.status(400).json({
        ok: false,
        error: 'Some agents not found or do not belong to you'
      });
    }

    let updateData = {};
    let message = '';

    switch (action) {
      case 'activate':
        updateData = { is_active: true };
        message = `${agents.length} agent(s) activated`;
        break;
      case 'deactivate':
        updateData = { is_active: false };
        message = `${agents.length} agent(s) deactivated`;
        break;
      default:
        return res.status(400).json({
          ok: false,
          error: 'Invalid action. Supported actions: activate, deactivate'
        });
    }

    // Perform bulk update
    const { error: updateError } = await supa
      .from('agents')
      .update(updateData)
      .in('id', agent_ids);

    if (updateError) {
      log.error('Bulk agent update error:', updateError);
      return res.status(500).json({
        ok: false,
        error: 'Failed to perform bulk action'
      });
    }

    res.json({
      ok: true,
      message,
      affected_agents: agents.length
    });

  } catch (error) {
    log.error('Bulk agent action error:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to perform bulk action'
    });
  }
});

export default router; 
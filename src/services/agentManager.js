import { supa } from '../lib/supabase.js';
import { retellCreatePhoneCall } from '../lib/retell.js';
import { Retell } from 'retell-sdk';
import { env } from '../config/env.js';
import { log } from '../config/logger.js';
import fs from 'fs/promises';
import path from 'path';

const retellClient = new Retell({ apiKey: env.RETELL_API_KEY });

class AgentManager {
  /**
   * Create a new agent for a business owner (independent of doctors)
   */
  async createAgentForOwner(ownerId, agentData = {}) {
    try {
      // Get owner details
      const { data: owner, error: ownerError } = await supa
        .from('users')
        .select('id, name')
        .eq('id', ownerId)
        .single();

      if (ownerError || !owner) {
        throw new Error('Business owner not found');
      }

      const {
        agent_name,
        language = 'pt-BR',
        voice_id = '11labs-Kate',
        ambient_sound = 'coffee-shop',
        custom_variables = {},
        // Additional conversation control fields
        agent_role,
        service_description,
        assistant_name,
        script = {}
      } = agentData;

      // Validation
      if (!agent_name) {
        throw new Error('Agent name is required');
      }

      // Load templates
      const agentTemplate = await this.loadAgentTemplate();
      const conversationFlowTemplate = await this.loadConversationFlowTemplate();

      // Generate agent configuration
      const agentConfig = await this.generateAgentConfig(owner, agentTemplate, {
        agent_name,
        language,
        voice_id,
        ambient_sound,
        ...agentData
      });

      const conversationFlow = await this.generateConversationFlow(owner, conversationFlowTemplate, {
        business_name: owner.name,
        ...custom_variables
      });

      // Create conversation flow in Retell
      const conversationFlowResponse = await retellClient.conversationFlow.create(conversationFlow);
      
      // Update agent config with conversation flow ID
      agentConfig.response_engine.conversation_flow_id = conversationFlowResponse.conversation_flow_id;

      // Create agent in Retell
      const agentResponse = await retellClient.agent.create(agentConfig);

      // Save to database
      const { data: dbAgent, error: dbError } = await supa
        .from('agents')
        .insert({
          owner_id: ownerId,
          agent_name: agent_name.trim(),
          agent_role: agent_role || 'Medical Assistant',
          service_description: service_description || `AI agent for ${owner.name}`,
          assistant_name: assistant_name || 'Clara',
          script: script,
          retell_agent_id: agentResponse.agent_id,
          conversation_flow_id: conversationFlowResponse.conversation_flow_id,
          language,
          voice_id,
          ambient_sound,
          custom_variables,
          is_active: true,
          is_published: false
        })
        .select()
        .single();

      if (dbError) {
        throw new Error(`Database error: ${dbError.message}`);
      }

      // Set as default agent if owner doesn't have one
      const { data: currentUser } = await supa
        .from('users')
        .select('default_agent_id')
        .eq('id', ownerId)
        .single();

      if (!currentUser?.default_agent_id) {
        await supa
          .from('users')
          .update({ default_agent_id: dbAgent.id })
          .eq('id', ownerId);
      }

      log.info(`Created agent ${dbAgent.id} for owner ${ownerId} (${owner.name})`);
      return dbAgent;

    } catch (error) {
      log.error('Error creating agent:', error);
      throw error;
    }
  }

  /**
   * Find the best doctor and agent for a lead based on owner's selection
   */
  async findDoctorAndAgentForLead(lead) {
    try {
      let whereClause = {};

      // If lead has an owner_id, only search within that owner's doctors
      if (lead.owner_id) {
        whereClause.owner_id = lead.owner_id;
      }

      // First, try to find a doctor with matching specialty
      const { data: doctors, error: doctorError } = await supa
        .from('doctors')
        .select('*')
        .match({
          ...whereClause,
          specialty: lead.specialty,
          is_active: true
        })
        .order('created_at', { ascending: true });

      if (doctorError) {
        throw new Error(`Doctor query error: ${doctorError.message}`);
      }

      let selectedDoctor = doctors?.[0]; // Get first available doctor with matching specialty

      // If no specific specialty match, try to find a general medicine doctor
      if (!selectedDoctor && lead.specialty !== 'Internal Medicine') {
        const { data: generalDoctors, error: generalError } = await supa
          .from('doctors')
          .select('*')
          .match({
            ...whereClause,
            specialty: 'Internal Medicine',
            is_active: true
          })
          .limit(1);

        if (!generalError && generalDoctors?.length > 0) {
          selectedDoctor = generalDoctors[0];
        }
      }

      if (!selectedDoctor) {
        throw new Error('No available doctor found for this specialty');
      }

      // Get owner's selected agent (use default or find suitable agent)
      let selectedAgent = null;

      if (lead.owner_id) {
        // Try to get owner's default agent first
        const { data: owner, error: ownerError } = await supa
          .from('users')
          .select(`
            default_agent_id,
            agents(*)
          `)
          .eq('id', lead.owner_id)
          .single();

        if (!ownerError && owner?.agents?.is_active) {
          selectedAgent = owner.agents;
        } else {
          // Find any active agent for this owner
          const { data: ownerAgents, error: agentError } = await supa
            .from('agents')
            .select('*')
            .eq('owner_id', lead.owner_id)
            .eq('is_active', true)
            .limit(1);

          if (!agentError && ownerAgents?.length > 0) {
            selectedAgent = ownerAgents[0];
          }
        }
      } else {
        // If no specific owner, find any available agent that can handle the specialty
        const { data: availableAgents, error: agentError } = await supa
          .from('agents')
          .select('*')
          .eq('is_active', true)
          .or(`specialties.cs.{${lead.specialty}},specialties.eq.{}`) // Either handles this specialty or handles all
          .limit(1);

        if (!agentError && availableAgents?.length > 0) {
          selectedAgent = availableAgents[0];
        }
      }

      if (!selectedAgent) {
        throw new Error('No available agent found for this lead');
      }

      return {
        doctor: selectedDoctor,
        agent: selectedAgent
      };

    } catch (error) {
      log.error('Error finding doctor/agent for lead:', error);
      throw error;
    }
  }

  /**
   * Update lead with doctor and agent assignment
   */
  async assignDoctorAndAgentToLead(leadId, doctor, agent) {
    try {
      // Generate dynamic variables for the agent
      const agentVariables = {
        doctor_name: doctor.name,
        doctor_specialty: doctor.specialty,
        doctor_bio: doctor.bio || `Especialista em ${doctor.specialty}`,
        doctor_languages: doctor.languages?.join(', ') || 'Português',
        consultation_price: doctor.consultation_price ? `R$ ${doctor.consultation_price}` : 'Consulte',
        return_consultation_price: doctor.return_consultation_price ? `R$ ${doctor.return_consultation_price}` : 'Consulte',
        consultation_duration: doctor.consultation_duration || 90,
        telemedicine_available: doctor.telemedicine_available ? 'Sim' : 'Não',
        doctor_phone: doctor.phone_number || '',
        doctor_address: doctor.office_address || '',
        doctor_city: doctor.city || '',
        doctor_tags: doctor.tags?.join(', ') || '',
        agent_name: agent.agent_name,
        agent_role: agent.agent_role || 'Medical Assistant',
        service_description: agent.service_description || '',
        assistant_name: agent.assistant_name || 'Clara',
        webhook_base_url: env.APP_BASE_URL,
        // Include script components
        script_greeting: agent.script?.greeting || 'Olá! Como posso ajudá-lo hoje?',
        script_service_description: agent.script?.service_description || agent.service_description || '',
        script_availability: agent.script?.availability || 'Estamos disponíveis de segunda a sexta, das 8h às 18h.',
        // Include agent's custom variables
        ...agent.custom_variables
      };

      // Update lead with assignment
      const { data: updatedLead, error } = await supa
        .from('leads')
        .update({
          assigned_doctor_id: doctor.id,
          assigned_agent_id: agent.id,
          agent_variables: agentVariables
        })
        .eq('id', leadId)
        .select()
        .single();

      if (error) {
        throw new Error(`Lead update error: ${error.message}`);
      }

      return updatedLead;

    } catch (error) {
      log.error('Error assigning doctor/agent to lead:', error);
      throw error;
    }
  }

  /**
   * Make outbound call with assigned agent
   */
  async makeOutboundCall(lead) {
    try {
      if (!lead.assigned_agent_id) {
        throw new Error('No agent assigned to lead');
      }

      // Get agent details
      const { data: agent, error: agentError } = await supa
        .from('agents')
        .select('*')
        .eq('id', lead.assigned_agent_id)
        .single();

      if (agentError || !agent) {
        throw new Error('Agent not found');
      }

      // Merge lead data with agent variables
      const callVariables = {
        ...lead.agent_variables,
        lead_id: lead.id,
        name: lead.name,
        phone: lead.phone,
        phone_last4: lead.phone.slice(-4),
        city: lead.city || '',
        specialty: lead.specialty || '',
        reason: lead.reason || '',
        urgency_level: lead.urgency_level || 1,
        preferred_language: lead.preferred_language || 'Português'
      };

      // Make the call using Retell
      const callResponse = await retellCreatePhoneCall({
        agent_id: agent.retell_agent_id,
        customer_number: lead.phone,
        customer_name: lead.name,
        metadata: callVariables,
        retell_llm_dynamic_variables: callVariables
      });

      log.info(`Outbound call initiated: ${callResponse.call_id} for lead ${lead.id}`);
      return callResponse;

    } catch (error) {
      log.error('Error making outbound call:', error);
      throw error;
    }
  }

  /**
   * Get all doctors for a business owner
   */
  async getDoctorsForOwner(ownerId, options = {}) {
    try {
      const { activeOnly = true } = options;

      let query = supa
        .from('doctors')
        .select('*')
        .eq('owner_id', ownerId);

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data: doctors, error } = await query.order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Error fetching doctors: ${error.message}`);
      }

      return doctors || [];
    } catch (error) {
      log.error('Error getting doctors for owner:', error);
      throw error;
    }
  }

  /**
   * Get all agents for a business owner
   */
  async getAgentsForOwner(ownerId, options = {}) {
    try {
      const { activeOnly = true } = options;

      let query = supa
        .from('agents')
        .select('*')
        .eq('owner_id', ownerId);

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data: agents, error } = await query.order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Error fetching agents: ${error.message}`);
      }

      return agents || [];
    } catch (error) {
      log.error('Error getting agents for owner:', error);
      throw error;
    }
  }

  /**
   * Create a new doctor for a business owner
   */
  async createDoctor(ownerId, doctorData) {
    try {
      const {
        name,
        email,
        phone_number,
        specialty,
        bio,
        languages = ['Português'],
        consultation_price,
        return_consultation_price,
        consultation_duration = 90,
        telemedicine_available = false,
        working_hours = {},
        timezone = 'America/Sao_Paulo',
        office_address,
        city,
        state,
        tags = []
      } = doctorData;

      // Validation
      if (!name || !specialty) {
        throw new Error('Name and specialty are required');
      }

      // Get specialty_id if exists
      const { data: specialtyData } = await supa
        .from('specialties')
        .select('id')
        .eq('name', specialty)
        .single();

      // Create doctor
      const { data: newDoctor, error: doctorError } = await supa
        .from('doctors')
        .insert({
          owner_id: ownerId,
          name: name.trim(),
          email: email?.trim(),
          phone_number,
          specialty,
          bio,
          languages: Array.isArray(languages) ? languages : [languages],
          consultation_price: consultation_price ? parseFloat(consultation_price) : null,
          return_consultation_price: return_consultation_price ? parseFloat(return_consultation_price) : null,
          consultation_duration: parseInt(consultation_duration),
          telemedicine_available: Boolean(telemedicine_available),
          working_hours,
          timezone,
          office_address,
          city,
          state,
          tags: Array.isArray(tags) ? tags : [],
          is_active: true
        })
        .select()
        .single();

      if (doctorError) {
        throw new Error(`Doctor creation error: ${doctorError.message}`);
      }

      log.info(`Created doctor ${newDoctor.id} for owner ${ownerId}`);
      return newDoctor;

    } catch (error) {
      log.error('Error creating doctor:', error);
      throw error;
    }
  }

  /**
   * Set default agent for owner
   */
  async setDefaultAgent(ownerId, agentId) {
    try {
      // Verify agent belongs to owner
      const { data: agent, error: agentError } = await supa
        .from('agents')
        .select('id')
        .eq('id', agentId)
        .eq('owner_id', ownerId)
        .eq('is_active', true)
        .single();

      if (agentError || !agent) {
        throw new Error('Agent not found or does not belong to you');
      }

      // Update user's default agent
      const { error: updateError } = await supa
        .from('users')
        .update({ default_agent_id: agentId })
        .eq('id', ownerId);

      if (updateError) {
        throw new Error(`Failed to set default agent: ${updateError.message}`);
      }

      log.info(`Set agent ${agentId} as default for owner ${ownerId}`);
      return true;

    } catch (error) {
      log.error('Error setting default agent:', error);
      throw error;
    }
  }

  /**
   * Get owner's current default agent
   */
  async getDefaultAgent(ownerId) {
    try {
      const { data: user, error } = await supa
        .from('users')
        .select(`
          default_agent_id,
          agents(*)
        `)
        .eq('id', ownerId)
        .single();

      if (error) {
        throw new Error(`Error fetching default agent: ${error.message}`);
      }

      return user?.agents || null;

    } catch (error) {
      log.error('Error getting default agent:', error);
      throw error;
    }
  }

  /**
   * Load agent template from file
   */
  async loadAgentTemplate() {
    try {
      const templatePath = path.join(process.cwd(), 'src/templates/agent-template.json');
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      return JSON.parse(templateContent);
    } catch (error) {
      log.error('Error loading agent template:', error);
      throw new Error('Failed to load agent template');
    }
  }

  /**
   * Load conversation flow template from file
   */
  async loadConversationFlowTemplate() {
    try {
      const templatePath = path.join(process.cwd(), 'src/templates/conversation-flow-template.json');
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      return JSON.parse(templateContent);
    } catch (error) {
      log.error('Error loading conversation flow template:', error);
      throw new Error('Failed to load conversation flow template');
    }
  }

  /**
   * Generate agent configuration from template
   */
  async generateAgentConfig(owner, template, options = {}) {
    const config = JSON.parse(JSON.stringify(template)); // Deep clone
    
    // Replace template variables
    const variables = {
      timestamp: Date.now(),
      agent_name: options.name || `${owner.name} Assistant`,
      conversation_flow_id: 'PLACEHOLDER', // Will be replaced after flow creation
      webhook_url: `${env.APP_BASE_URL}/retell/webhook`,
      language: options.language || 'pt-BR',
      voice_id: options.voice_id || '11labs-Kate',
      version_title: `${options.name || 'Business'} Agent v1.0`,
      ambient_sound: options.ambient_sound || 'coffee-shop'
    };

    return this.replaceTemplateVariables(config, variables);
  }

  /**
   * Generate conversation flow from template
   */
  async generateConversationFlow(owner, template, options = {}) {
    const flow = JSON.parse(JSON.stringify(template)); // Deep clone
    
    // Replace template variables
    const variables = {
      assistant_name: 'Clara',
      business_name: owner.name || 'Nossa Clínica',
      webhook_base_url: env.APP_BASE_URL,
      // Include any custom variables passed in options
      ...options
    };

    return this.replaceTemplateVariables(flow, variables);
  }

  /**
   * Replace template variables in object
   */
  replaceTemplateVariables(obj, variables) {
    if (typeof obj === 'string') {
      let result = obj;
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        result = result.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
      }
      return result;
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.replaceTemplateVariables(item, variables));
    } else if (obj !== null && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceTemplateVariables(value, variables);
      }
      return result;
    }
    return obj;
  }

  /**
   * Update agent configuration
   */
  async updateAgent(agentId, updates) {
    try {
      const { data: agent, error } = await supa
        .from('agents')
        .update(updates)
        .eq('id', agentId)
        .select()
        .single();

      if (error) {
        throw new Error(`Error updating agent: ${error.message}`);
      }

      // If agent config changed, update in Retell as well
      if (updates.agent_config && agent.retell_agent_id) {
        await retellClient.agent.update(agent.retell_agent_id, updates.agent_config);
      }

      return agent;
    } catch (error) {
      log.error('Error updating agent:', error);
      throw error;
    }
  }

  /**
   * Get performance statistics for an owner's agents
   */
  async getOwnerAgentStats(ownerId, options = {}) {
    try {
      const { timeframe = '30d' } = options;
      
      // Calculate date filter based on timeframe
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

      // Get call attempts for owner's agents
      const { data: callAttempts, error } = await supa
        .from('call_attempts')
        .select(`
          *,
          agents(id, name),
          doctors(id, name, specialty)
        `)
        .eq('owner_id', ownerId)
        .gte('created_at', dateFilter.toISOString());

      if (error) {
        throw new Error(`Error fetching stats: ${error.message}`);
      }

      // Calculate statistics
      const stats = {
        total_calls: callAttempts?.length || 0,
        successful_calls: callAttempts?.filter(ca => ca.outcome === 'completed').length || 0,
        average_duration: 0,
        by_agent: {},
        by_doctor: {},
        by_outcome: {}
      };

      // Calculate average duration
      const completedCalls = callAttempts?.filter(ca => ca.duration_seconds) || [];
      if (completedCalls.length > 0) {
        stats.average_duration = Math.round(
          completedCalls.reduce((sum, ca) => sum + ca.duration_seconds, 0) / completedCalls.length
        );
      }

      // Group by agent, doctor, and outcome
      callAttempts?.forEach(ca => {
        // By agent
        if (ca.agents) {
          const agentKey = ca.agents.id;
          if (!stats.by_agent[agentKey]) {
            stats.by_agent[agentKey] = {
              agent_name: ca.agents.name,
              total_calls: 0,
              successful_calls: 0
            };
          }
          stats.by_agent[agentKey].total_calls++;
          if (ca.outcome === 'completed') {
            stats.by_agent[agentKey].successful_calls++;
          }
        }

        // By doctor
        if (ca.doctors) {
          const doctorKey = ca.doctors.id;
          if (!stats.by_doctor[doctorKey]) {
            stats.by_doctor[doctorKey] = {
              doctor_name: ca.doctors.name,
              specialty: ca.doctors.specialty,
              total_calls: 0,
              successful_calls: 0
            };
          }
          stats.by_doctor[doctorKey].total_calls++;
          if (ca.outcome === 'completed') {
            stats.by_doctor[doctorKey].successful_calls++;
          }
        }

        // By outcome
        const outcome = ca.outcome || 'unknown';
        stats.by_outcome[outcome] = (stats.by_outcome[outcome] || 0) + 1;
      });

      return stats;

    } catch (error) {
      log.error('Error getting owner agent stats:', error);
      throw error;
    }
  }
}

export const agentManager = new AgentManager();
export default AgentManager; 
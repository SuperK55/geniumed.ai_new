#!/usr/bin/env node

/**
 * Update Interruption Handling Settings for Existing Agents
 * 
 * This script updates all existing Retell agents with improved
 * interruption sensitivity and backchannel word configurations.
 * 
 * Usage:
 *   node scripts/update-agent-interruption-settings.js [--dry-run] [--agent-id=<id>]
 * 
 * Options:
 *   --dry-run     Show what would be updated without making changes
 *   --agent-id    Update only a specific agent (for testing)
 */

import { Retell } from 'retell-sdk';
import { env } from '../src/config/env.js';
import { supa } from '../src/lib/supabase.js';
import { log } from '../src/config/logger.js';

const retellClient = new Retell({ apiKey: env.RETELL_API_KEY });

// New optimized settings
const IMPROVED_SETTINGS = {
  interruption_sensitivity: 0.75,  // Reduced from 0.97
  enable_backchannel: true,
  backchannel_frequency: 0.9,
  backchannel_words: [
    "ah",
    "aham",
    "uhum",
    "sim",
    "ok",
    "tá",
    "certo",
    "entendi",
    "legal",
    "show",
    "perfeito",
    "beleza",
    "que bom",
    "maravilha",
    "isso mesmo",
    "claro",
    "pode ser",
    "ótimo",
    "certeza"
  ]
};

async function updateAgent(agentId, dryRun = false) {
  try {
    // Get current agent configuration
    const currentAgent = await retellClient.agent.retrieve(agentId);
    
    log.info(`Processing agent: ${currentAgent.agent_name} (${agentId})`);
    
    // Check if update is needed
    const needsUpdate = 
      currentAgent.interruption_sensitivity !== IMPROVED_SETTINGS.interruption_sensitivity ||
      currentAgent.backchannel_words?.length !== IMPROVED_SETTINGS.backchannel_words.length;
    
    if (!needsUpdate) {
      log.info(`✓ Agent ${agentId} already has optimized settings`);
      return { agentId, status: 'already_updated', agent_name: currentAgent.agent_name };
    }
    
    log.info(`Current settings:`, {
      interruption_sensitivity: currentAgent.interruption_sensitivity,
      backchannel_words: currentAgent.backchannel_words?.length || 0
    });
    
    log.info(`New settings:`, {
      interruption_sensitivity: IMPROVED_SETTINGS.interruption_sensitivity,
      backchannel_words: IMPROVED_SETTINGS.backchannel_words.length
    });
    
    if (dryRun) {
      log.info(`[DRY RUN] Would update agent ${agentId}`);
      return { agentId, status: 'would_update', agent_name: currentAgent.agent_name };
    }
    
    // Update the agent
    await retellClient.agent.update(agentId, IMPROVED_SETTINGS);
    
    log.info(`✓ Successfully updated agent ${agentId}`);
    return { agentId, status: 'updated', agent_name: currentAgent.agent_name };
    
  } catch (error) {
    log.error(`✗ Error updating agent ${agentId}:`, error.message);
    return { agentId, status: 'error', error: error.message };
  }
}

async function getAllAgents() {
  try {
    const { data: agents, error } = await supa
      .from('agents')
      .select('id, agent_name, retell_agent_id, is_active')
      .eq('is_active', true)
      .not('retell_agent_id', 'is', null);
    
    if (error) throw error;
    return agents || [];
  } catch (error) {
    log.error('Error fetching agents from database:', error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const specificAgentArg = args.find(arg => arg.startsWith('--agent-id='));
  const specificAgentId = specificAgentArg ? specificAgentArg.split('=')[1] : null;
  
  console.log('\n===========================================');
  console.log('Agent Interruption Settings Update Script');
  console.log('===========================================\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }
  
  try {
    let agentsToUpdate = [];
    
    if (specificAgentId) {
      console.log(`Targeting specific agent: ${specificAgentId}\n`);
      agentsToUpdate = [{ retell_agent_id: specificAgentId }];
    } else {
      console.log('Fetching all active agents from database...\n');
      agentsToUpdate = await getAllAgents();
      console.log(`Found ${agentsToUpdate.length} active agents\n`);
    }
    
    const results = {
      updated: [],
      already_updated: [],
      would_update: [],
      errors: []
    };
    
    // Update agents one by one
    for (const agent of agentsToUpdate) {
      const result = await updateAgent(agent.retell_agent_id, dryRun);
      results[result.status].push(result);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Print summary
    console.log('\n===========================================');
    console.log('Update Summary');
    console.log('===========================================\n');
    
    if (dryRun) {
      console.log(`Would update: ${results.would_update.length} agents`);
      if (results.would_update.length > 0) {
        results.would_update.forEach(r => {
          console.log(`  - ${r.agent_name || r.agentId}`);
        });
      }
    } else {
      console.log(`✓ Updated: ${results.updated.length} agents`);
      if (results.updated.length > 0) {
        results.updated.forEach(r => {
          console.log(`  - ${r.agent_name || r.agentId}`);
        });
      }
    }
    
    console.log(`✓ Already optimized: ${results.already_updated.length} agents`);
    if (results.already_updated.length > 0 && results.already_updated.length <= 5) {
      results.already_updated.forEach(r => {
        console.log(`  - ${r.agent_name || r.agentId}`);
      });
    }
    
    if (results.errors.length > 0) {
      console.log(`\n✗ Errors: ${results.errors.length} agents`);
      results.errors.forEach(r => {
        console.log(`  - ${r.agentId}: ${r.error}`);
      });
    }
    
    console.log('\n===========================================\n');
    
    if (dryRun) {
      console.log('💡 Run without --dry-run to apply changes\n');
    } else {
      console.log('✅ Update complete!\n');
      console.log('Next steps:');
      console.log('1. Test a few calls to verify behavior');
      console.log('2. Monitor interruption metrics in call_analysis');
      console.log('3. Adjust interruption_sensitivity if needed (0.7-0.8 range)\n');
    }
    
    process.exit(results.errors.length > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n✗ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { updateAgent, IMPROVED_SETTINGS };


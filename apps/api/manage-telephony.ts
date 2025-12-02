#!/usr/bin/env tsx
/**
 * Admin script to manage telephony configurations
 *
 * Usage:
 *   List pending configs:
 *     tsx manage-telephony.ts list
 *
 *   Activate a config:
 *     tsx manage-telephony.ts activate <agent-id>
 *
 * Example:
 *   tsx manage-telephony.ts list
 *   tsx manage-telephony.ts activate 48e23290-9ef4-483f-ad32-103ddd8400a1
 */

import dotenv from 'dotenv';
import { db } from './src/db.js';

dotenv.config({ path: '../../.env.local' });

const command = process.argv[2];
const agentId = process.argv[3];

async function listPending() {
  console.log('\n📋 Pending Telephony Configurations\n');
  console.log('=' .repeat(80));

  const { supabase } = await import('./src/supabase.js');
  const { data, error } = await supabase
    .from('telephony_configs')
    .select(`
      *,
      agent_configs!inner(id, name, user_id)
    `)
    .eq('is_active', false)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch pending configs:', error);
    process.exit(1);
  }

  if (!data || data.length === 0) {
    console.log('\n✅ No pending telephony configurations!\n');
    return;
  }

  console.log(`\nFound ${data.length} pending configuration(s):\n`);

  data.forEach((config: any, index: number) => {
    console.log(`${index + 1}. Agent: ${config.agent_configs.name}`);
    console.log(`   Agent ID: ${config.agent_config_id}`);
    console.log(`   Phone Number: ${config.phone_number}`);
    console.log(`   SIP Domain: ${config.sip_domain}`);
    console.log(`   Dispatch Rule: ${config.dispatch_rule_id || 'N/A'}`);
    console.log(`   Created: ${new Date(config.created_at).toLocaleString()}`);
    console.log(`
   ⚡ To activate: tsx manage-telephony.ts activate ${config.agent_config_id}
    `);
    console.log('-'.repeat(80));
  });

  console.log('\n📝 Next Steps for Each Config:');
  console.log('   1. Verify telephony provider has completed SIP configuration');
  console.log('   2. Test inbound call to the phone number');
  console.log('   3. Run: tsx manage-telephony.ts activate <agent-id>');
  console.log('');
}

async function activateConfig(agentId: string) {
  console.log(`\n⚡ Activating telephony for agent: ${agentId}\n`);

  // Get the agent config
  const agentConfig = await db.getAgentConfig(agentId);
  if (!agentConfig) {
    console.error(`❌ Agent not found: ${agentId}`);
    process.exit(1);
  }

  console.log(`Agent Name: ${agentConfig.name}`);

  // Get telephony config
  const telephonyConfig = await db.getTelephonyConfigByAgentId(agentId);
  if (!telephonyConfig) {
    console.error(`❌ No telephony configuration found for this agent`);
    process.exit(1);
  }

  console.log(`Phone Number: ${telephonyConfig.phoneNumber}`);
  console.log(`SIP Domain: ${telephonyConfig.sipDomain}`);

  if (telephonyConfig.isActive) {
    console.log('\n⚠️  Telephony is already active for this agent!');
    process.exit(0);
  }

  // Activate
  const updated = await db.updateTelephonyConfig(telephonyConfig.id, {
    isActive: true,
  });

  if (!updated) {
    console.error('❌ Failed to activate telephony');
    process.exit(1);
  }

  console.log('\n✅ Telephony activated successfully!');
  console.log(`
   Status: ACTIVE
   Phone: ${updated.phoneNumber}

   The agent can now receive calls at this number! 🎉
  `);
}

async function main() {
  if (!command) {
    console.log(`
Usage:
  List pending configs:     tsx manage-telephony.ts list
  Activate a config:        tsx manage-telephony.ts activate <agent-id>

Example:
  npx tsx manage-telephony.ts list
  npx tsx manage-telephony.ts activate 48e23290-9ef4-483f-ad32-103ddd8400a1
    `);
    process.exit(1);
  }

  switch (command) {
    case 'list':
      await listPending();
      break;

    case 'activate':
      if (!agentId) {
        console.error('❌ Agent ID is required for activate command');
        console.log('Usage: tsx manage-telephony.ts activate <agent-id>');
        process.exit(1);
      }
      await activateConfig(agentId);
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log('Available commands: list, activate');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

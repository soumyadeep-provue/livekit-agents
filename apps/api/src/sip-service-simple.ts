/**
 * Simplified SIP Service
 * Clean implementation without complex type issues
 */

import { SipClient, RoomServiceClient } from 'livekit-server-sdk';
import type { TelephonyConfig } from '@studio/shared';
import { db } from './db.js';

const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

const AGENT_NAME = 'studio-voice-agent';

function getSipClient(): SipClient {
  return new SipClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function getRoomClient(): RoomServiceClient {
  return new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

export interface SipSetupResult {
  trunkId: string;
  dispatchRuleId: string;
  sipUri: string;
  sipUsername: string;
  sipPassword: string;
}

/**
 * Create individual trunk and dispatch rule for an agent
 */
export async function setupTelephony(
  agentId: string,
  phoneNumber: string
): Promise<SipSetupResult> {
  const sipClient = getSipClient();

  // Use Exotel API credentials for SIP authentication
  const sipUsername = process.env.EXOTEL_API_KEY!;
  const sipPassword = process.env.EXOTEL_API_TOKEN!;

  if (!sipUsername || !sipPassword) {
    throw new Error('Missing Exotel credentials: EXOTEL_API_KEY and EXOTEL_API_TOKEN are required');
  }

  console.log(`[SIP] Setting up for agent ${agentId}`);

  // Create trunk - simplified with type assertions for SDK compatibility
  const trunkResult = await (sipClient.createSipInboundTrunk as any)(
    {
      name: `trunk-${agentId.slice(0, 8)}`,
      numbers: [phoneNumber],
      authUsername: sipUsername,
      authPassword: sipPassword,
    }
  );

  const trunkId = trunkResult?.sipTrunkId || `trunk-${agentId.slice(0, 8)}`;

  // Create dispatch rule - simplified with type assertions
  const ruleResult = await (sipClient.createSipDispatchRule as any)({
    rule: {
      dispatchRuleIndividual: {
        roomPrefix: `call-${agentId.slice(0, 8)}-`,
      },
    },
    name: `rule-${agentId.slice(0, 8)}`,
    trunkIds: [trunkId],
  });

  const dispatchRuleId = ruleResult?.sipDispatchRuleId || `rule-${agentId.slice(0, 8)}`;

  // Generate SIP URI
  const projectId = LIVEKIT_URL.replace('wss://', '').replace('.livekit.cloud', '');
  const sipDomain = `${projectId}.sip.livekit.cloud`;
  const sipUri = `sip:${sipUsername}@${sipDomain}`;

  console.log('[SIP] Setup complete');
  console.log(`[SIP] SIP URI: ${sipUri}`);
  console.log(`[SIP] Username: ${sipUsername}`);

  return {
    trunkId,
    dispatchRuleId,
    sipUri,
    sipUsername,
    sipPassword,
  };
}

/**
 * Clean up telephony resources
 */
export async function teardownTelephony(config: TelephonyConfig): Promise<void> {
  const sipClient = getSipClient();

  if (config.dispatchRuleId) {
    try {
      await sipClient.deleteSipDispatchRule(config.dispatchRuleId);
      console.log(`[SIP] Deleted dispatch rule: ${config.dispatchRuleId}`);
    } catch (e) {
      console.warn('[SIP] Could not delete dispatch rule:', e);
    }
  }

  // Note: SDK might not support trunk deletion
  console.log(`[SIP] Note: Trunk ${config.inboundTrunkId} may need manual deletion`);
}

/**
 * Place outbound call
 */
export async function placeOutboundCall(
  agentId: string,
  toNumber: string
): Promise<{ roomName: string }> {
  const roomClient = getRoomClient();
  const sipClient = getSipClient();

  const config = await db.getTelephonyConfigByAgentId(agentId);
  if (!config) {
    throw new Error('No telephony config for agent');
  }

  // Create room
  const roomName = `call-out-${Date.now()}`;
  await roomClient.createRoom({
    name: roomName,
    emptyTimeout: 300,
    metadata: JSON.stringify({
      agentId,
      toNumber,
      type: 'outbound',
    }),
  });

  // Create SIP participant
  await sipClient.createSipParticipant(
    config.inboundTrunkId,
    toNumber,
    roomName
  );

  return { roomName };
}

export { listTrunks } from './sip-service.js';
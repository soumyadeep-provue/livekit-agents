import { SipClient, RoomServiceClient, RoomAgentDispatch } from 'livekit-server-sdk';
import type { TelephonyConfig } from '@studio/shared';
import { db } from './db.js';

const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

function getSipClient(): SipClient {
  return new SipClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function getRoomClient(): RoomServiceClient {
  return new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

export interface SetupTelephonyResult {
  trunkId: string;
  dispatchRuleId: string;
  sipUri: string;
  sipUsername: string;
  sipPassword: string;
}

/**
 * Set up telephony for an agent with individual trunk
 *
 * This creates:
 * 1. An individual inbound trunk for this agent
 * 2. A dispatch rule that routes calls to rooms with the agent
 *
 * @param agentConfigId - Agent configuration ID
 * @param phoneNumber - The Exophone assigned to this agent
 * @returns Trunk and dispatch configuration
 */
export async function setupTelephonyForAgent(
  agentConfigId: string,
  phoneNumber: string
): Promise<SetupTelephonyResult> {
  const sipClient = getSipClient();

  console.log(`[SIP] Setting up telephony for agent ${agentConfigId}`);
  console.log(`[SIP] Phone number: ${phoneNumber}`);

  // Use Exotel API credentials for SIP authentication
  // Exotel uses API key as username and API token as password
  const sipUsername = process.env.EXOTEL_API_KEY!;
  const sipPassword = process.env.EXOTEL_API_TOKEN!;

  if (!sipUsername || !sipPassword) {
    throw new Error('Missing Exotel credentials: EXOTEL_API_KEY and EXOTEL_API_TOKEN are required');
  }

  try {
    // Step 1: Create an inbound trunk for this specific agent
    console.log('[SIP] Creating inbound trunk...');
    const trunkName = `trunk-${agentConfigId.slice(0, 8)}`;

    // Exotel uses API key/token for SIP authentication (configured above)
    // No IP whitelisting needed - Exotel will authenticate using the credentials
    const trunkInfo = await sipClient.createSipInboundTrunk(
      trunkName,
      [phoneNumber],
      {
        authUsername: sipUsername,
        authPassword: sipPassword,
        metadata: JSON.stringify({
          agentConfigId,
          phoneNumber,
          createdAt: new Date().toISOString(),
          provider: 'exotel',
        }),
      }
    );

    // The SDK returns SIPInboundTrunkInfo with sipTrunkId field
    const trunkId = trunkInfo.sipTrunkId;
    console.log(`[SIP] Trunk created: ${trunkId}`);

    // Step 2: Create dispatch rule for routing calls
    console.log('[SIP] Creating dispatch rule...');

    // Agent name used for telephony dispatch
    const TELEPHONY_AGENT_NAME = 'studio-voice-agent';

    // The SDK expects the rule as first parameter, options as second
    const dispatchRuleInfo = await sipClient.createSipDispatchRule(
      {
        type: 'individual',
        roomPrefix: `call-${agentConfigId.slice(0, 8)}-`,
      },
      {
        name: `dispatch-${agentConfigId.slice(0, 8)}`,
        trunkIds: [trunkId],
        hidePhoneNumber: false,
        metadata: JSON.stringify({
          agentConfigId,
          phoneNumber,
        }),
        // Configure room to dispatch agent when SIP call comes in
        // Use partial roomConfig - LiveKit will use defaults for other fields
        roomConfig: {
          agents: [
            new RoomAgentDispatch({ agentName: TELEPHONY_AGENT_NAME }),
          ],
        } as any, // Type assertion needed as RoomConfiguration requires many fields, but SIP dispatch only needs agents
      }
    );

    // The SDK returns SIPDispatchRuleInfo with sipDispatchRuleId field
    const dispatchRuleId = dispatchRuleInfo.sipDispatchRuleId;
    console.log(`[SIP] Dispatch rule created: ${dispatchRuleId}`);

    // Step 3: Generate SIP URI for Exotel configuration
    // Use Exotel-whitelisted SIP domain if provided, otherwise construct from LIVEKIT_URL
    let sipDomain = '';
    const EXOTEL_SIP_DOMAIN = process.env.EXOTEL_SIP_DOMAIN; // e.g., "4j7vfy40b9i.sip.livekit.cloud"
    
    if (EXOTEL_SIP_DOMAIN) {
      // Use the Exotel-whitelisted domain
      sipDomain = EXOTEL_SIP_DOMAIN;
      console.log(`[SIP] Using Exotel-whitelisted SIP domain: ${sipDomain}`);
    } else {
      // Fallback: Extract project ID from LiveKit URL to construct SIP domain
      const projectId = LIVEKIT_URL.replace('wss://', '').replace('.livekit.cloud', '');
      sipDomain = `${projectId}.sip.livekit.cloud`;
      console.log(`[SIP] Constructed SIP domain from LIVEKIT_URL: ${sipDomain}`);
    }

    const sipUri = `sip:${sipUsername}@${sipDomain}`;

    console.log('[SIP] Configuration complete:');
    console.log(`[SIP]   SIP URI: ${sipUri}`);
    console.log(`[SIP]   Username (Exotel API Key): ${sipUsername}`);
    console.log(`[SIP]   Password (Exotel API Token): ${sipPassword.substring(0, 4)}****`);

    // Store the SIP domain as platform config (same for all agents in the project)
    // Note: Trunk ID is stored per-agent in telephony_configs table, not as platform config
    await db.setPlatformConfig('LIVEKIT_EXOTEL_FQDN', sipDomain);

    return {
      trunkId,
      dispatchRuleId,
      sipUri,
      sipUsername,
      sipPassword,
    };
  } catch (error) {
    console.error('[SIP] Failed to setup telephony:', error);
    throw error;
  }
}


/**
 * Recreate telephony setup for an existing config
 * This will delete old resources and create new ones
 *
 * @param config - Existing telephony configuration
 * @returns New trunk and dispatch configuration
 */
export async function recreateTelephonySetup(config: TelephonyConfig): Promise<SetupTelephonyResult> {
  const sipClient = getSipClient();

  // Clean up old resources first
  if (config.dispatchRuleId) {
    try {
      await sipClient.deleteSipDispatchRule(config.dispatchRuleId);
      console.log(`[SIP] Deleted old dispatch rule: ${config.dispatchRuleId}`);
    } catch (e) {
      console.warn(`[SIP] Failed to delete old dispatch rule:`, e);
    }
  }

  // Delete old trunk if it exists
  if (config.inboundTrunkId) {
    try {
      await sipClient.deleteSipTrunk(config.inboundTrunkId);
      console.log(`[SIP] Deleted old trunk: ${config.inboundTrunkId}`);
    } catch (e) {
      console.warn(`[SIP] Failed to delete old trunk:`, e);
    }
  }

  // Create new setup with individual trunk
  return await setupTelephonyForAgent(
    config.agentConfigId,
    config.phoneNumber
  );
}

/**
 * Tear down telephony for an agent
 * Deletes both the trunk and dispatch rule (since each agent has their own)
 */
export async function teardownTelephony(config: TelephonyConfig): Promise<void> {
  const sipClient = getSipClient();

  console.log(`[SIP] Tearing down telephony for agent ${config.agentConfigId}`);

  // Delete dispatch rule first
  if (config.dispatchRuleId) {
    try {
      await sipClient.deleteSipDispatchRule(config.dispatchRuleId);
      console.log(`[SIP] Deleted dispatch rule: ${config.dispatchRuleId}`);
    } catch (e) {
      console.error('[SIP] Failed to delete dispatch rule:', e);
    }
  }

  // Delete the trunk (each agent has their own now)
  if (config.inboundTrunkId) {
    try {
      await sipClient.deleteSipTrunk(config.inboundTrunkId);
      console.log(`[SIP] Deleted trunk: ${config.inboundTrunkId}`);
    } catch (e) {
      console.error('[SIP] Failed to delete trunk:', e);
    }
  }
}


/**
 * Place an outbound call using Exotel's Call API
 *
 * This function:
 * 1. Creates a LiveKit room for the call
 * 2. Uses Exotel's API to dial the customer
 * 3. Connects the call to the LiveKit room via SIP
 * 4. The agent will join the room and talk to the customer
 *
 * @param agentConfigId - Agent configuration ID
 * @param toPhoneNumber - Customer's phone number (E.164 format)
 * @returns Call details including room name and call SID
 */
export async function placeOutboundCall(
  agentConfigId: string,
  toPhoneNumber: string
): Promise<{ roomName: string; callSid: string }> {
  // Get agent's telephony configuration
  const telephonyConfig = await db.getTelephonyConfigByAgentId(agentConfigId);
  if (!telephonyConfig) {
    throw new Error('Agent does not have telephony enabled');
  }

  // For outbound calls, we'll use the SIP Participant API instead of Exotel
  // This is the proper way to handle outbound calls with LiveKit

  const sipClient = getSipClient();
  const roomClient = getRoomClient();

  // Generate unique room name for this call
  const roomName = `call-out-${agentConfigId.slice(0, 8)}-${Date.now()}`;

  // Create room with agent dispatch
  console.log(`[SIP] Creating room for outbound call: ${roomName}`);
  await roomClient.createRoom({
    name: roomName,
    emptyTimeout: 300, // 5 minutes
    maxParticipants: 10,
    metadata: JSON.stringify({
      agentConfigId,
      type: 'outbound',
      isOutboundCall: true,
      toPhoneNumber
    }),
  });

  console.log(`[SIP] Room created: ${roomName}`);

  // Create SIP participant in the room
  // This initiates the outbound call
  try {
    console.log(`[SIP] Creating SIP participant for outbound call`);
    console.log(`[SIP]   From: ${telephonyConfig.phoneNumber}`);
    console.log(`[SIP]   To: ${toPhoneNumber}`);
    console.log(`[SIP]   Trunk: ${telephonyConfig.inboundTrunkId}`);

    // Use the agent's trunk for outbound calls
    // The createSipParticipant method signature: (trunkId, toNumber, roomName, options?)
    await sipClient.createSipParticipant(
      telephonyConfig.inboundTrunkId,
      toPhoneNumber,
      roomName,
      {
        participantIdentity: `sip-${Date.now()}`,
        participantName: `Outbound Call to ${toPhoneNumber}`,
        participantMetadata: JSON.stringify({
          type: 'outbound',
          agentConfigId,
          fromNumber: telephonyConfig.phoneNumber,
        }),
        dtmf: '',
        playDialtone: true,
        hidePhoneNumber: false,
      }
    );

    console.log(`[SIP] Outbound call initiated successfully`);

    return {
      roomName,
      callSid: `call-${Date.now()}`, // Generate a call ID for tracking
    };
  } catch (error) {
    console.error('[SIP] Failed to create SIP participant:', error);
    // Clean up room if call fails
    await roomClient.deleteRoom(roomName);
    throw error;
  }
}

/**
 * List all SIP trunks (for debugging)
 */
export async function listTrunks() {
  const sipClient = getSipClient();

  const [inbound, outbound] = await Promise.all([
    sipClient.listSipInboundTrunk(),
    sipClient.listSipOutboundTrunk(),
  ]);

  return { inbound, outbound };
}

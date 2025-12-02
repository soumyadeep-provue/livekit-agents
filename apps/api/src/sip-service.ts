import { SipClient, RoomServiceClient, RoomAgentDispatch } from 'livekit-server-sdk';
import { SIPTransport } from '@livekit/protocol';
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
  inboundTrunkId: string;
  outboundTrunkId: string;
  dispatchRuleId: string;
  sipUri: string;
  sipDomain: string;
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

  // Exotel uses IP-based authentication, not username/password
  // Get Exotel's SIP server IP addresses for whitelisting
  // These IPs should be provided by Exotel support
  const exotelSipIPs = (process.env.EXOTEL_SIP_IPS || '').split(',').filter(ip => ip.trim());

  if (exotelSipIPs.length === 0) {
    console.warn('[SIP] Warning: No Exotel SIP IPs configured. Trunk will accept calls from any IP.');
    console.warn('[SIP] Set EXOTEL_SIP_IPS environment variable with comma-separated IPs for security.');
  } else {
    console.log('[SIP] Whitelisting Exotel IPs:', exotelSipIPs);
  }

  try {
    // Step 1: Create an inbound trunk for this specific agent
    console.log('[SIP] Creating inbound trunk...');
    const inboundTrunkName = `trunk-in-${agentConfigId.slice(0, 8)}`;

    // Exotel uses IP-based authentication
    // Configure trunk to accept calls from Exotel's IP addresses
    const trunkOptions: any = {
      metadata: JSON.stringify({
        agentConfigId,
        phoneNumber,
        createdAt: new Date().toISOString(),
        provider: 'exotel',
        direction: 'inbound',
      }),
    };

    // Add IP whitelisting if Exotel IPs are configured
    if (exotelSipIPs.length > 0) {
      trunkOptions.allowedAddresses = exotelSipIPs;
    }
    // Otherwise, trunk will accept from any IP (less secure but works for testing)

    const inboundTrunkInfo = await sipClient.createSipInboundTrunk(
      inboundTrunkName,
      [phoneNumber],
      trunkOptions
    );

    // The SDK returns SIPInboundTrunkInfo with sipTrunkId field
    const inboundTrunkId = inboundTrunkInfo.sipTrunkId;
    console.log(`[SIP] Inbound trunk created: ${inboundTrunkId}`);

    // Step 1.5: Create an outbound trunk for making calls
    console.log('[SIP] Creating outbound trunk...');
    const outboundTrunkName = `trunk-out-${agentConfigId.slice(0, 8)}`;

    // Use Exotel's SIP server for outbound (from pcap analysis)
    const EXOTEL_OUTBOUND_SIP = process.env.EXOTEL_OUTBOUND_SIP || '143.223.91.185:5060';
    const EXOTEL_SIP_USERNAME = process.env.EXOTEL_SIP_USERNAME;
    const EXOTEL_SIP_PASSWORD = process.env.EXOTEL_SIP_PASSWORD;

    // For Exotel, remove +91 prefix (use 2247790694 format, not 02247790694 or +912247790694)
    const exotelNumber = phoneNumber.replace(/^\+91/, '').replace(/^0/, '');
    console.log(`[SIP] Using Exotel outbound SIP address: ${EXOTEL_OUTBOUND_SIP}`);
    console.log(`[SIP] Phone number for Exotel: ${exotelNumber} (without +91 or 0 prefix)`);
    console.log(`[SIP] SIP Auth: ${EXOTEL_SIP_USERNAME ? 'Username configured' : 'No username (IP-based auth)'}`);

    const outboundTrunkInfo = await sipClient.createSipOutboundTrunk(
      outboundTrunkName,
      EXOTEL_OUTBOUND_SIP,  // Exotel's SIP server
      [exotelNumber],  // From number in Exotel format (without +91 or 0)
      {
        transport: SIPTransport.SIP_TRANSPORT_AUTO,
        authUsername: EXOTEL_SIP_USERNAME,
        authPassword: EXOTEL_SIP_PASSWORD,
        metadata: JSON.stringify({
          agentConfigId,
          phoneNumber,
          createdAt: new Date().toISOString(),
          provider: 'exotel',
          direction: 'outbound',
        }),
      }
    );

    const outboundTrunkId = outboundTrunkInfo.sipTrunkId;
    console.log(`[SIP] Outbound trunk created: ${outboundTrunkId}`);

    // Step 2: Create dispatch rule for routing inbound calls
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
        trunkIds: [inboundTrunkId],
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
          // IMPORTANT: Set metadata on the room so the agent can access agentConfigId
          metadata: JSON.stringify({
            agentConfigId,
            phoneNumber,
            type: 'inbound',
          }),
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

    // For Exotel, the SIP URI is just the domain (no username)
    // Exotel support will map your phone number to this domain
    const sipUri = `sip:${sipDomain}`;

    console.log('[SIP] Configuration complete:');
    console.log(`[SIP]   SIP Domain: ${sipDomain}`);
    console.log(`[SIP]   SIP URI (for Exotel): ${sipUri}`);
    console.log(`[SIP]   Phone Number: ${phoneNumber}`);
    console.log(`[SIP]   Authentication: IP-based (${exotelSipIPs.length > 0 ? exotelSipIPs.join(', ') : 'any IP'})`);

    // Store the SIP domain as platform config (same for all agents in the project)
    // Note: Trunk ID is stored per-agent in telephony_configs table, not as platform config
    await db.setPlatformConfig('LIVEKIT_EXOTEL_FQDN', sipDomain);

    return {
      inboundTrunkId,
      outboundTrunkId,
      dispatchRuleId,
      sipUri,
      sipDomain,
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

  // Delete inbound trunk
  if (config.inboundTrunkId) {
    try {
      await sipClient.deleteSipTrunk(config.inboundTrunkId);
      console.log(`[SIP] Deleted inbound trunk: ${config.inboundTrunkId}`);
    } catch (e) {
      console.error('[SIP] Failed to delete inbound trunk:', e);
    }
  }

  // Delete outbound trunk
  if (config.outboundTrunkId) {
    try {
      await sipClient.deleteSipTrunk(config.outboundTrunkId);
      console.log(`[SIP] Deleted outbound trunk: ${config.outboundTrunkId}`);
    } catch (e) {
      console.error('[SIP] Failed to delete outbound trunk:', e);
    }
  }
}


/**
 * Place an outbound call using Exotel's Call API
 *
 * This function:
 * 1. Creates a LiveKit room for the call
 * 2. Uses Exotel's Call API to dial the customer
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

  // Get Exotel credentials
  const EXOTEL_ACCOUNT_SID = process.env.EXOTEL_ACCOUNT_SID || process.env.EXOTEL_API_KEY;
  const EXOTEL_API_KEY = process.env.EXOTEL_API_KEY;
  const EXOTEL_API_TOKEN = process.env.EXOTEL_API_TOKEN;
  const EXOTEL_SUBDOMAIN = process.env.EXOTEL_SUBDOMAIN;
  const EXOTEL_APP_ID = process.env.EXOTEL_APP_ID || '33560';

  if (!EXOTEL_API_KEY || !EXOTEL_API_TOKEN || !EXOTEL_SUBDOMAIN) {
    throw new Error('Missing Exotel credentials. Set EXOTEL_API_KEY, EXOTEL_API_TOKEN, and EXOTEL_SUBDOMAIN');
  }

  try {
    console.log(`[Exotel] Placing outbound call via Exotel Call API`);
    console.log(`[Exotel]   From: ${telephonyConfig.phoneNumber}`);
    console.log(`[Exotel]   To: ${toPhoneNumber}`);
    console.log(`[Exotel]   App ID (Flow): ${EXOTEL_APP_ID}`);
    console.log(`[Exotel]   Account SID: ${EXOTEL_ACCOUNT_SID}`);
    console.log(`[Exotel]   Note: Flow will connect to LiveKit inbound trunk`);
    console.log(`[Exotel]   Dispatch rule will create room and agent will auto-join`);

    // Use Exotel's Call API with the configured flow
    // The flow connects to LiveKit inbound trunk, dispatch rule creates room
    const exotelUrl = `https://${EXOTEL_SUBDOMAIN}.exotel.com/v1/Accounts/${EXOTEL_ACCOUNT_SID}/Calls/connect.json`;

    // Create Basic Auth header
    const credentials = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString('base64');
    const authHeader = `Basic ${credentials}`;

    // Format numbers for Exotel (remove +91 for Indian numbers)
    const exotelFromNumber = telephonyConfig.phoneNumber.replace(/^\+91/, '');
    const exotelToNumber = toPhoneNumber.replace(/^\+91/, '');

    const formData = new URLSearchParams({
      From: exotelFromNumber,    // Our Exotel number
      To: exotelToNumber,        // Customer's number
      CallerId: exotelFromNumber, // Caller ID
      CallType: 'trans',         // Transactional call
      AppId: EXOTEL_APP_ID,      // Flow that connects to LiveKit SIP trunk
    });

    console.log(`[Exotel] Request parameters:`);
    console.log(`[Exotel]   From: ${exotelFromNumber}`);
    console.log(`[Exotel]   To: ${exotelToNumber}`);
    console.log(`[Exotel]   CallerId: ${exotelFromNumber}`);
    console.log(`[Exotel]   AppId: ${EXOTEL_APP_ID}`);

    const response = await fetch(exotelUrl, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Exotel] API error (${response.status}):`, errorText);
      throw new Error(`Exotel API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log(`[Exotel] Call initiated:`, JSON.stringify(result, null, 2));

    // Room will be created by dispatch rule when call connects
    // Room name follows pattern: call-{agentIdPrefix}-{uniqueId}
    const roomName = `call-${agentConfigId.slice(0, 8)}-${result.Call?.Sid || Date.now()}`;

    return {
      roomName,
      callSid: result.Call?.Sid || `call-${Date.now()}`,
    };
  } catch (error) {
    console.error('[Exotel] Failed to place outbound call:', error);
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

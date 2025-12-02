import type { CreateAgentConfigRequest, CreateTelephonyConfigRequest, GetPublicTokenRequest, OAuthConnectionStatus, OAuthProvider, OutboundCallRequest, ShareInfoResponse, TelephonyStatusResponse, TokenResponse, UpdateAgentConfigRequest } from '@studio/shared';
import { CreateAgentConfigRequestSchema, CreateTelephonyConfigRequestSchema, GetPublicTokenRequestSchema, GetTokenRequestSchema, OAUTH_PROVIDERS, OutboundCallRequestSchema, TOOL_OPTIONS, UpdateAgentConfigRequestSchema } from '@studio/shared';
import cors from 'cors';
import dotenv from 'dotenv';
import express, { type Request, type Response, type NextFunction } from 'express';
import { AccessToken, RoomAgentDispatch, RoomServiceClient, type VideoGrant } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { db } from './db.js';
import { placeOutboundCall, setupTelephonyForAgent, teardownTelephony, recreateTelephonySetup, listTrunks } from './sip-service.js';
import { createExotelClient, type ExophoneResponse } from './integrations/exotel-client.js';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// LiveKit configuration
const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/oauth/google/callback';

// Google Calendar scopes
const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

// Validation middleware
const validate = <T extends z.ZodSchema>(schema: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store original body for debugging
    (req as any).originalBody = JSON.parse(JSON.stringify(req.body));
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'Validation error', details: result.error.errors });
      return;
    }
    req.body = result.data;
    next();
  };
};

// Simple auth middleware (replace with real auth in production)
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized - missing x-user-id header' });
    return;
  }
  (req as Request & { userId: string }).userId = userId;
  next();
};

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ============ Agent Config Routes ============

// List all agent configs for a user
app.get('/api/agents', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const agents = await db.getAgentConfigsByUser(userId);
  res.json(agents);
});

// Get a specific agent config
app.get('/api/agents/:id', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const agent = await db.getAgentConfig(req.params.id);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (agent.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  res.json(agent);
});

// Create a new agent config
app.post(
  '/api/agents',
  authenticate,
  validate(CreateAgentConfigRequestSchema),
  async (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const data = req.body as CreateAgentConfigRequest;

    try {
      const agent = await db.createAgentConfig(userId, data);
      res.status(201).json(agent);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create agent' });
    }
  }
);

// Update an agent config
app.put(
  '/api/agents/:id',
  authenticate,
  validate(UpdateAgentConfigRequestSchema),
  async (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const existing = await db.getAgentConfig(req.params.id);

    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (existing.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const data = req.body as UpdateAgentConfigRequest;
    const updated = await db.updateAgentConfig(req.params.id, data);
    res.json(updated);
  }
);

// Delete an agent config
app.delete('/api/agents/:id', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const existing = await db.getAgentConfig(req.params.id);

  if (!existing) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (existing.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  await db.deleteAgentConfig(req.params.id);
  res.status(204).send();
});

// ============ Token Generation Routes ============

// Generate a token for connecting to a room with an agent
app.post(
  '/api/token',
  authenticate,
  validate(GetTokenRequestSchema),
  async (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const { agentConfigId, participantName } = req.body as { agentConfigId: string; participantName?: string };

    // Verify the agent config exists and belongs to the user
    const agentConfig = await db.getAgentConfig(agentConfigId);
    if (!agentConfig) {
      res.status(404).json({ error: 'Agent config not found' });
      return;
    }

    if (agentConfig.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Create a unique room for this session
    const roomName = `room-${uuidv4()}`;
    const participantIdentity = participantName || `user-${uuidv4().slice(0, 8)}`;

    // Create room with metadata containing agent config
    const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const roomMetadata = JSON.stringify({
      userId,
      agentConfigId,
      agentConfig: {
        id: agentConfig.id,
        userId: agentConfig.userId,
        name: agentConfig.name,
        instructions: agentConfig.instructions,
        voice: agentConfig.voice,
        greeting: agentConfig.greeting,
        model: agentConfig.model,
        sttModel: agentConfig.sttModel,
        ttsModel: agentConfig.ttsModel,
        tools: agentConfig.tools,
      },
    });

    await roomService.createRoom({
      name: roomName,
      metadata: roomMetadata,
      emptyTimeout: 300, // 5 minutes
      maxParticipants: 2, // User + Agent
      agents: [
        new RoomAgentDispatch({ agentName: 'studio-voice-agent' }),
      ],
    });

    // Generate access token for the user
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: participantIdentity,
      name: participantName || 'User',
    });

    const grant: VideoGrant = {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    };

    token.addGrant(grant);

    const response: TokenResponse = {
      token: await token.toJwt(),
      url: LIVEKIT_URL,
      roomName,
    };

    res.json(response);
  }
);

// ============ Public Sharing Routes ============

// Get info about a shared agent (no auth required)
app.get('/api/share/:shareCode', async (req: Request, res: Response) => {
  const { shareCode } = req.params;

  const agentConfig = await db.getAgentConfigByShareCode(shareCode);
  if (!agentConfig) {
    res.status(404).json({ error: 'Shared agent not found' });
    return;
  }

  const response: ShareInfoResponse = {
    name: agentConfig.name,
    greeting: agentConfig.greeting,
    shareCode: agentConfig.shareCode!,
  };

  res.json(response);
});

// Generate a token for a shared agent (no auth required)
app.post('/api/share/:shareCode/token', async (req: Request, res: Response) => {
  const { shareCode } = req.params;
  const { participantName } = req.body as GetPublicTokenRequest;

  // Find the agent by share code
  const agentConfig = await db.getAgentConfigByShareCode(shareCode);
  if (!agentConfig) {
    res.status(404).json({ error: 'Shared agent not found' });
    return;
  }

  // Create a unique room for this session
  const roomName = `shared-${uuidv4()}`;
  const participantIdentity = participantName || `guest-${uuidv4().slice(0, 8)}`;

  // Create room with metadata containing agent config
  const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

  const roomMetadata = JSON.stringify({
    userId: agentConfig.userId,
    agentConfigId: agentConfig.id,
    isSharedSession: true,
    agentConfig: {
      id: agentConfig.id,
      userId: agentConfig.userId,
      name: agentConfig.name,
      instructions: agentConfig.instructions,
      voice: agentConfig.voice,
      greeting: agentConfig.greeting,
      model: agentConfig.model,
      sttModel: agentConfig.sttModel,
      ttsModel: agentConfig.ttsModel,
      tools: agentConfig.tools,
    },
  });

  await roomService.createRoom({
    name: roomName,
    metadata: roomMetadata,
    emptyTimeout: 300, // 5 minutes
    maxParticipants: 2, // Guest + Agent
    agents: [
      new RoomAgentDispatch({ agentName: 'studio-voice-agent' }),
    ],
  });

  // Generate access token for the guest
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName || 'Guest',
  });

  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };

  token.addGrant(grant);

  const response: TokenResponse = {
    token: await token.toJwt(),
    url: LIVEKIT_URL,
    roomName,
  };

  res.json(response);
});

// ============ User Routes ============

// Get or create user (simplified for demo)
app.post('/api/users', async (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email || !name) {
    res.status(400).json({ error: 'email and name are required' });
    return;
  }

  try {
    let user = await db.getUserByEmail(email);
    if (!user) {
      user = await db.createUser(email, name);
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get or create user' });
  }
});

// Get user by ID
app.get('/api/users/:id', async (req: Request, res: Response) => {
  const user = await db.getUser(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// ============ OAuth Routes ============

// In-memory store for OAuth state (use Redis in production)
const oauthStates = new Map<string, { userId: string; expiresAt: number }>();

// Get user's OAuth connections
app.get('/api/oauth/connections', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const connections = await db.getOAuthConnectionsByUser(userId);

  const response: OAuthConnectionStatus[] = connections.map(conn => ({
    id: conn.id,
    provider: conn.provider as OAuthProvider,
    email: conn.email,
    isConnected: true,
    connectedAt: conn.createdAt,
  }));

  res.json(response);
});

// Start Google OAuth flow
app.get('/api/oauth/google', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    res.status(500).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
    return;
  }

  // Generate state token for CSRF protection
  const state = uuidv4();
  oauthStates.set(state, {
    userId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  // Build Google OAuth URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  res.json({ authUrl: authUrl.toString() });
});

// Google OAuth callback
app.get('/api/oauth/google/callback', async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=error&message=${encodeURIComponent(error as string)}`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=error&message=missing_params`);
    return;
  }

  // Validate state
  const stateData = oauthStates.get(state as string);
  if (!stateData || stateData.expiresAt < Date.now()) {
    oauthStates.delete(state as string);
    res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=error&message=invalid_state`);
    return;
  }

  oauthStates.delete(state as string);
  const userId = stateData.userId;

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code: code as string,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_REDIRECT_URI,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=error&message=token_exchange_failed`);
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    // Get user email
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let email: string | undefined;
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json() as { email: string };
      email = userInfo.email;
    }

    // Store tokens
    await db.upsertOAuthConnection(userId, OAUTH_PROVIDERS.GOOGLE, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
      email,
    });

    res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=success&provider=google`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.WEB_URL || 'http://localhost:5173'}/settings?oauth=error&message=unknown_error`);
  }
});

// Disconnect OAuth provider
app.delete('/api/oauth/:provider', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const provider = req.params.provider as OAuthProvider;

  if (provider !== OAUTH_PROVIDERS.GOOGLE) {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  const deleted = await db.deleteOAuthConnection(userId, provider);
  if (!deleted) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  res.status(204).send();
});

// Internal endpoint for agent to fetch agent config (requires API key auth)
app.get('/api/internal/agents/:agentId', async (req: Request, res: Response) => {
  // Simple API key auth for internal agent calls
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== LIVEKIT_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { agentId } = req.params;

  try {
    const agentConfig = await db.getAgentConfig(agentId);
    if (!agentConfig) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(agentConfig);
  } catch (error) {
    console.error('Error fetching agent config:', error);
    res.status(500).json({ error: 'Failed to fetch agent config' });
  }
});

// Internal endpoint for agent to get OAuth tokens (requires API key auth)
app.get('/api/internal/oauth/:userId/:provider', async (req: Request, res: Response) => {
  // Simple API key auth for internal agent calls
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== LIVEKIT_API_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { userId, provider } = req.params;

  if (provider !== OAUTH_PROVIDERS.GOOGLE) {
    res.status(400).json({ error: 'Invalid provider' });
    return;
  }

  const connection = await db.getOAuthConnection(userId, provider as OAuthProvider);
  if (!connection) {
    res.status(404).json({ error: 'OAuth connection not found' });
    return;
  }

  // Check if token is expired and needs refresh
  if (connection.expiresAt && connection.expiresAt < new Date() && connection.refreshToken) {
    try {
      // Refresh the token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID!,
          client_secret: GOOGLE_CLIENT_SECRET!,
          refresh_token: connection.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json() as {
          access_token: string;
          expires_in: number;
        };

        // Update stored token
        await db.updateOAuthConnection(userId, provider as OAuthProvider, {
          accessToken: tokens.access_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        });

        res.json({ accessToken: tokens.access_token });
        return;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
  }

  res.json({ accessToken: connection.accessToken });
});

// Get available tools and their status
app.get('/api/tools', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const connections = await db.getOAuthConnectionsByUser(userId);

  const tools = TOOL_OPTIONS.map(tool => {
    let status: 'available' | 'needs_auth' | 'needs_api_key' = 'available';
    let connectedEmail: string | undefined;

    if (tool.requiresAuth) {
      const connection = connections.find(c => c.provider === (tool as any).authProvider);
      if (!connection) {
        status = 'needs_auth';
      } else {
        connectedEmail = connection.email;
      }
    }

    if ((tool as any).requiresApiKey) {
      const envVar = (tool as any).apiKeyEnvVar;
      if (!process.env[envVar]) {
        status = 'needs_api_key';
      }
    }

    return {
      ...tool,
      status,
      connectedEmail,
    };
  });

  res.json(tools);
});

// ============ Telephony Routes ============

// Get telephony config for an agent
app.get('/api/agents/:id/telephony', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const agentConfig = await db.getAgentConfig(req.params.id);

  if (!agentConfig) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (agentConfig.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const telephonyConfig = await db.getTelephonyConfigByAgentId(req.params.id);
  if (!telephonyConfig) {
    res.status(404).json({ error: 'Telephony not configured for this agent' });
    return;
  }

  // Return safe response without credentials
  const response: TelephonyStatusResponse = {
    id: telephonyConfig.id,
    agentConfigId: telephonyConfig.agentConfigId,
    phoneNumber: telephonyConfig.phoneNumber,
    isActive: telephonyConfig.isActive,
    hasInbound: !!telephonyConfig.dispatchRuleId,
    hasOutbound: true, // Outbound via Exotel Call API
    createdAt: telephonyConfig.createdAt,
  };

  // Include SIP URI for configuration (safe to expose)
  const sipUri = `sip:${telephonyConfig.sipDomain}`;

  res.json({
    ...response,
    sipUri, // Include SIP URI for Exotel configuration
    sipDomain: telephonyConfig.sipDomain,
  });
});

// Setup telephony for an agent
app.post(
  '/api/agents/:id/telephony',
  authenticate,
  validate(CreateTelephonyConfigRequestSchema),
  async (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const agentConfig = await db.getAgentConfig(req.params.id);

    if (!agentConfig) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (agentConfig.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Check if telephony already exists
    const existing = await db.getTelephonyConfigByAgentId(req.params.id);
    if (existing) {
      res.status(400).json({ error: 'Telephony already configured for this agent. Delete it first to reconfigure.' });
      return;
    }

    const data = req.body as CreateTelephonyConfigRequest;
    const region = data.region || 'MH';
    
    // Check original body for phoneNumber (in case Zod stripped it)
    const originalBody = (req as any).originalBody || {};
    const providedPhoneNumber = (data as any).phoneNumber || originalBody.phoneNumber;
    
    console.log('[Telephony] Validated data:', JSON.stringify(data));
    console.log('[Telephony] Original body:', JSON.stringify(originalBody));
    console.log('[Telephony] Provided phoneNumber:', providedPhoneNumber);

    try {
      const exotel = createExotelClient();
      let phoneNumber: string;
      let exophoneSid: string;
      let purchased: ExophoneResponse;

      // 1. Use existing number or buy new one
      if (providedPhoneNumber && typeof providedPhoneNumber === 'string' && providedPhoneNumber.trim().length > 0) {
        // Use existing phone number
        phoneNumber = providedPhoneNumber.trim();
        console.log(`[Telephony] Using existing phone number: ${phoneNumber}`);
        
        // Find the ExophoneSid for this number
        let existingNumbers: ExophoneResponse[];
        try {
          console.log('[Telephony] Calling exotel.listNumbers()...');
          existingNumbers = await exotel.listNumbers();
          console.log('[Telephony] Got', existingNumbers.length, 'numbers from Exotel');
        } catch (listError) {
          console.error('[Telephony] Failed to list numbers:', listError);
          console.error('[Telephony] Error stack:', listError instanceof Error ? listError.stack : 'No stack');
          throw new Error(`Failed to list Exotel numbers: ${listError instanceof Error ? listError.message : String(listError)}`);
        }
        console.log('[Telephony] Looking for phone number:', phoneNumber);
        console.log('[Telephony] Available numbers:', existingNumbers.map(n => n.IncomingPhoneNumber.PhoneNumber));
        
        // Normalize phone numbers for comparison (remove +91, spaces, dashes, etc.)
        const normalizePhone = (num: string): string => {
          return num.replace(/^\+91/, '').replace(/^91/, '').replace(/[\s\-\(\)]/g, '');
        };
        
        const normalizedSearch = normalizePhone(phoneNumber);
        console.log('[Telephony] Normalized search:', normalizedSearch);
        
        const existingNumber = existingNumbers.find((n) => {
          const num = n.IncomingPhoneNumber.PhoneNumber;
          const normalizedNum = normalizePhone(num);
          console.log(`[Telephony] Comparing: "${num}" (normalized: "${normalizedNum}") with "${phoneNumber}" (normalized: "${normalizedSearch}")`);
          return normalizedNum === normalizedSearch || num === phoneNumber || num === `+91${normalizedSearch}` || num === `91${normalizedSearch}`;
        });

        if (!existingNumber) {
          res.status(400).json({ 
            error: `Phone number ${phoneNumber} not found in your Exotel account. Available numbers: ${existingNumbers.map(n => n.IncomingPhoneNumber.PhoneNumber).join(', ') || 'none'}. Please verify the number or buy a new one.` 
          });
          return;
        }

        exophoneSid = existingNumber.IncomingPhoneNumber.Sid;
        purchased = existingNumber;
        console.log(`[Telephony] Found existing Exophone SID: ${exophoneSid}`);
      } else {
        // Buy new Exotel virtual number
        const available = await exotel.searchAvailableNumbers(region);

        if (!available || available.length === 0) {
          res.status(400).json({ error: `No available phone numbers in region ${region}. Try a different region.` });
          return;
        }

        phoneNumber = available[0].phone_number;
        purchased = await exotel.buyNumber(phoneNumber, `agent-${req.params.id.slice(0, 8)}`);
        exophoneSid = purchased.IncomingPhoneNumber.Sid;
      }

      // 2. Create LiveKit trunk and dispatch rule for this agent
      const sipResult = await setupTelephonyForAgent(
        req.params.id,
        phoneNumber
      );

      // 3. Save telephony config to database
      const telephonyConfig = await db.createTelephonyConfig(req.params.id, {
        phoneNumber,
        exophoneSid: exophoneSid,
        inboundTrunkId: sipResult.trunkId,
        sipDomain: sipResult.sipDomain,
        dispatchRuleId: sipResult.dispatchRuleId,
      });

      // 4. Log Exotel configuration instructions
      console.log(`
📧 IMPORTANT: Contact Exotel Support to Configure:
   ========================================
   Phone Number: ${phoneNumber}
   LiveKit SIP Domain: ${sipResult.sipDomain}
   Full SIP URI: ${sipResult.sipUri}

   NEXT STEPS:
   1. Contact Exotel Support
   2. Provide them with this SIP domain: ${sipResult.sipDomain}
   3. Request them to map your phone number to this domain
   4. Authentication is IP-based (no credentials needed)
   ========================================
      `.trim());

      const response: TelephonyStatusResponse = {
        id: telephonyConfig.id,
        agentConfigId: telephonyConfig.agentConfigId,
        phoneNumber: telephonyConfig.phoneNumber,
        isActive: false, // Not active until Exotel configures SIP settings
        hasInbound: true,
        hasOutbound: true,
        createdAt: telephonyConfig.createdAt,
      };

      res.status(201).json({
        ...response,
        sipConfig: {
          sipUri: sipResult.sipUri,
          sipDomain: sipResult.sipDomain,
        },
        message: `Phone number ${phoneNumber} provisioned. Contact Exotel Support to map this number to SIP domain: ${sipResult.sipDomain}`,
      });
    } catch (error) {
      console.error('Failed to setup telephony:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      res.status(500).json({
        error: 'Failed to setup telephony. Please check logs for details.',
        details: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  }
);

// Delete telephony config for an agent
app.delete('/api/agents/:id/telephony', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const agentConfig = await db.getAgentConfig(req.params.id);

  if (!agentConfig) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (agentConfig.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const telephonyConfig = await db.getTelephonyConfigByAgentId(req.params.id);
  if (!telephonyConfig) {
    res.status(404).json({ error: 'Telephony not configured for this agent' });
    return;
  }

  try {
    // 1. Teardown SIP resources in LiveKit (dispatch rule)
    await teardownTelephony(telephonyConfig);

    // 2. Release Exophone (virtual number) back to Exotel
    // ⚠️⚠️⚠️ DISABLED - DO NOT RELEASE TRIAL PHONE NUMBERS! ⚠️⚠️⚠️
    // User requested to keep phone numbers and implement manual release later
    // try {
    //   const exotel = createExotelClient();
    //   await exotel.releaseNumber(telephonyConfig.exophoneSid);
    //   console.log(`Released Exophone ${telephonyConfig.phoneNumber} (${telephonyConfig.exophoneSid})`);
    // } catch (exotelError) {
    //   console.error('Failed to release Exophone:', exotelError);
    //   // Continue with deletion even if Exotel release fails
    // }
    console.log(`⚠️ NOT releasing phone number: ${telephonyConfig.phoneNumber} (manual release required)`);

    // 3. Delete from DB
    await db.deleteTelephonyConfig(telephonyConfig.id);

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete telephony:', error);
    res.status(500).json({ error: 'Failed to delete telephony configuration' });
  }
});

// Fix existing dispatch rule by recreating it with PIN
// This fixes dispatch rules that were created without the PIN field
app.post('/api/agents/:id/telephony/fix-dispatch', authenticate, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: string }).userId;
  const agentConfig = await db.getAgentConfig(req.params.id);

  if (!agentConfig) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  if (agentConfig.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const telephonyConfig = await db.getTelephonyConfigByAgentId(req.params.id);
  if (!telephonyConfig) {
    res.status(404).json({ error: 'Telephony not configured for this agent' });
    return;
  }

  try {
    // Recreate dispatch rule with PIN
    const result = await recreateTelephonySetup(telephonyConfig);

    // Update database with new trunk and dispatch rule
    await db.updateTelephonyConfig(telephonyConfig.id, {
      inboundTrunkId: result.trunkId,
      dispatchRuleId: result.dispatchRuleId,
      sipDomain: result.sipDomain,
    });

    res.json({
      message: 'Dispatch rule recreated with agent name successfully',
      dispatchRuleId: result.dispatchRuleId,
      sipUri: result.sipUri,
      sipDomain: result.sipDomain,
    });
  } catch (error) {
    console.error('Failed to fix dispatch rule:', error);
    res.status(500).json({
      error: 'Failed to fix dispatch rule',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Place an outbound call
app.post(
  '/api/call',
  authenticate,
  validate(OutboundCallRequestSchema),
  async (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const data = req.body as OutboundCallRequest;

    // Verify agent exists and belongs to user
    const agentConfig = await db.getAgentConfig(data.agentConfigId);
    if (!agentConfig) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (agentConfig.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Get telephony config
    const telephonyConfig = await db.getTelephonyConfigByAgentId(data.agentConfigId);
    if (!telephonyConfig || !telephonyConfig.isActive) {
      res.status(400).json({ error: 'Telephony not configured or not active for this agent' });
      return;
    }

    try {
      // Place the outbound call using Exotel
      // This will:
      // 1. Create a LiveKit room
      // 2. Call the customer via Exotel
      // 3. Connect the call to the room
      // 4. Agent will join and talk to them
      const result = await placeOutboundCall(
        data.agentConfigId,
        data.toPhoneNumber
      );

      res.json({
        roomName: result.roomName,
        callSid: result.callSid,
        status: 'calling',
      });
    } catch (error) {
      console.error('Failed to place outbound call:', error);
      res.status(500).json({ error: 'Failed to place outbound call' });
    }
  }
);

// Start server
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log('Environment:', {
    LIVEKIT_URL: LIVEKIT_URL ? 'set' : 'NOT SET',
    LIVEKIT_API_KEY: LIVEKIT_API_KEY ? 'set' : 'NOT SET',
    LIVEKIT_API_SECRET: LIVEKIT_API_SECRET ? 'set' : 'NOT SET',
    SUPABASE_URL: process.env.SUPABASE_URL ? 'set' : 'NOT SET',
    SUPABASE_KEY: process.env.SUPABASE_KEY ? 'set' : 'NOT SET',
    GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID ? 'set' : 'NOT SET',
    GOOGLE_CLIENT_SECRET: GOOGLE_CLIENT_SECRET ? 'set' : 'NOT SET',
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY ? 'set' : 'NOT SET',
  });
});

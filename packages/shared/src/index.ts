import { z } from 'zod';

// Agent configuration schema
export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().min(1).max(100),
  instructions: z.string().min(1).max(5000),
  voice: z.string().default('ash'), // Default: OpenAI Ash (for gpt-4o-mini-tts)
  voiceInstructions: z.string().optional(), // Instructions for TTS tone/style (gpt-4o-mini-tts only)
  greeting: z.string().optional(),
  model: z.enum(['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o']).default('gpt-4.1-mini'),
  sttModel: z.enum(['openai/gpt-4o-transcribe', 'openai/whisper-1', 'deepgram/nova-3', 'assemblyai/universal-streaming']).default('openai/gpt-4o-transcribe'),
  ttsModel: z.enum(['openai/gpt-4o-mini-tts', 'openai/tts-1', 'openai/tts-1-hd', 'elevenlabs/eleven_turbo_v2_5', 'elevenlabs/eleven_multilingual_v2', 'cartesia/sonic-3']).default('openai/gpt-4o-mini-tts'),
  tools: z.array(z.string()).default([]),
  // Sharing settings
  isPublic: z.boolean().default(false),
  shareCode: z.string().min(8).max(16).optional(), // Unique code for sharing
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// User schema
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(100),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// Room metadata schema - passed to the agent via room metadata
export const RoomMetadataSchema = z.object({
  userId: z.string().uuid(),
  agentConfigId: z.string().uuid(),
  agentConfig: AgentConfigSchema.omit({ createdAt: true, updatedAt: true }),
});

export type RoomMetadata = z.infer<typeof RoomMetadataSchema>;

// API request/response types
export const CreateAgentConfigRequestSchema = AgentConfigSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateAgentConfigRequest = z.infer<typeof CreateAgentConfigRequestSchema>;

export const UpdateAgentConfigRequestSchema = CreateAgentConfigRequestSchema.partial();

export type UpdateAgentConfigRequest = z.infer<typeof UpdateAgentConfigRequestSchema>;

// Token request schema (authenticated)
export const GetTokenRequestSchema = z.object({
  agentConfigId: z.string().uuid(),
  participantName: z.string().min(1).max(100).optional(),
});

export type GetTokenRequest = z.infer<typeof GetTokenRequestSchema>;

// Public token request schema (for shared agents)
export const GetPublicTokenRequestSchema = z.object({
  shareCode: z.string().min(8).max(16),
  participantName: z.string().min(1).max(100).optional(),
});

export type GetPublicTokenRequest = z.infer<typeof GetPublicTokenRequestSchema>;

// Token response
export interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
}

// Share info response (public agent details)
export interface ShareInfoResponse {
  name: string;
  greeting?: string;
  shareCode: string;
}

// ============ Telephony Configuration ============

// Telephony config schema
export const TelephonyConfigSchema = z.object({
  id: z.string().uuid(),
  agentConfigId: z.string().uuid(),
  // Phone number
  phoneNumber: z.string().min(10).max(20), // E.164 format, e.g., "+919876543210"
  // Exotel-specific
  exophoneSid: z.string(), // Exotel's ID for the virtual number
  // LiveKit - individual trunk per agent
  inboundTrunkId: z.string(), // LiveKit inbound trunk ID (unique per agent)
  sipDomain: z.string(), // SIP domain (e.g., project.sip.livekit.cloud)
  dispatchRuleId: z.string().optional(), // LiveKit dispatch rule ID
  // Status
  isActive: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TelephonyConfig = z.infer<typeof TelephonyConfigSchema>;

// Create telephony config request (simplified for Exotel)
export const CreateTelephonyConfigRequestSchema = z.object({
  region: z.string().default('MH'), // Indian telecom circle (MH=Maharashtra, DL=Delhi, KA=Karnataka, etc.)
  phoneNumber: z.string().optional(), // Optional: Use existing phone number instead of buying new one
});

export type CreateTelephonyConfigRequest = z.infer<typeof CreateTelephonyConfigRequestSchema>;

// Update telephony config request
export const UpdateTelephonyConfigRequestSchema = z.object({
  isActive: z.boolean().optional(),
});

export type UpdateTelephonyConfigRequest = z.infer<typeof UpdateTelephonyConfigRequestSchema>;

// Telephony status response (safe version without credentials)
export interface TelephonyStatusResponse {
  id: string;
  agentConfigId: string;
  phoneNumber: string;
  isActive: boolean;
  hasInbound: boolean;
  hasOutbound: boolean;
  createdAt: Date;
}

// Outbound call request
export const OutboundCallRequestSchema = z.object({
  agentConfigId: z.string().uuid(),
  toPhoneNumber: z.string().min(10).max(20),
});

export type OutboundCallRequest = z.infer<typeof OutboundCallRequestSchema>;

// Outbound call response
export const OutboundCallResponseSchema = z.object({
  roomName: z.string(),
  callSid: z.string(),
  status: z.enum(['calling', 'in-progress', 'completed', 'failed']),
});

export type OutboundCallResponse = z.infer<typeof OutboundCallResponseSchema>;

// Helper to generate share codes
export function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 10; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Available voice options
export const VOICE_OPTIONS = [
  // OpenAI voices for tts-1 and tts-1-hd (legacy models)
  { id: 'alloy', name: 'Alloy (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  { id: 'echo', name: 'Echo (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  { id: 'fable', name: 'Fable (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  { id: 'onyx', name: 'Onyx (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  { id: 'nova', name: 'Nova (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  { id: 'shimmer', name: 'Shimmer (OpenAI Legacy)', provider: 'openai', language: 'en-US', model: 'legacy' },
  // OpenAI voices for gpt-4o-mini-tts (latest model)
  { id: 'ash', name: 'Ash (OpenAI)', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts' },
  { id: 'ballad', name: 'Ballad (OpenAI)', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts' },
  { id: 'coral', name: 'Coral (OpenAI)', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts' },
  { id: 'sage', name: 'Sage (OpenAI)', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts' },
  { id: 'verse', name: 'Verse (OpenAI)', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts' },
  // ElevenLabs English voices
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
  // ElevenLabs Indian English voices
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian (ElevenLabs)', provider: 'elevenlabs', language: 'en-IN' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric (ElevenLabs)', provider: 'elevenlabs', language: 'en-IN' },
  // ElevenLabs Hindi voices (use with eleven_multilingual_v2)
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (ElevenLabs)', provider: 'elevenlabs', language: 'hi-IN' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte (ElevenLabs)', provider: 'elevenlabs', language: 'hi-IN' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice (ElevenLabs)', provider: 'elevenlabs', language: 'en-GB' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris (ElevenLabs)', provider: 'elevenlabs', language: 'en-US' },
] as const;

// Available model options
export const LLM_OPTIONS = [
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
] as const;

export const STT_OPTIONS = [
  { id: 'openai/gpt-4o-transcribe', name: 'OpenAI GPT-4o Transcribe (Streaming)', provider: 'openai' },
  { id: 'openai/whisper-1', name: 'OpenAI Whisper', provider: 'openai' },
  { id: 'deepgram/nova-3', name: 'Deepgram Nova 3', provider: 'deepgram' },
  { id: 'assemblyai/universal-streaming', name: 'AssemblyAI Universal', provider: 'assemblyai' },
] as const;

export const TTS_OPTIONS = [
  { id: 'openai/gpt-4o-mini-tts', name: 'OpenAI GPT-4o Mini TTS (Latest)', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'openai/tts-1', name: 'OpenAI TTS-1 (Standard)', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'openai/tts-1-hd', name: 'OpenAI TTS-1 HD (Higher Quality)', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'elevenlabs/eleven_turbo_v2_5', name: 'ElevenLabs Turbo v2.5', provider: 'elevenlabs', languages: ['en'] },
  { id: 'elevenlabs/eleven_multilingual_v2', name: 'ElevenLabs Multilingual v2', provider: 'elevenlabs', languages: ['en', 'hi', 'ta', 'de', 'fr', 'es', 'ja', 'zh', 'ko', 'pt', 'it', 'ar', 'ru'] },
  { id: 'cartesia/sonic-3', name: 'Cartesia Sonic 3', provider: 'cartesia', languages: ['en'] },
] as const;

// ============ Tools Configuration ============

// Available tool types
export const TOOL_TYPES = {
  WEB_SEARCH: 'web_search',
  GOOGLE_CALENDAR: 'google_calendar',
  END_CALL: 'end_call',
} as const;

export type ToolType = typeof TOOL_TYPES[keyof typeof TOOL_TYPES];

// Tool definitions for UI (END_CALL is not included as it's always enabled by default)
export const TOOL_OPTIONS = [
  {
    id: TOOL_TYPES.WEB_SEARCH,
    name: 'Web Search',
    description: 'Search the web for real-time information using Perplexity',
    requiresAuth: false,
    requiresApiKey: true,
    apiKeyEnvVar: 'PERPLEXITY_API_KEY',
  },
  {
    id: TOOL_TYPES.GOOGLE_CALENDAR,
    name: 'Google Calendar',
    description: 'Read and create calendar events',
    requiresAuth: true,
    authProvider: 'google',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events'],
  },
] as const;

// Agent tools configuration schema
// Note: END_CALL is always enabled by default and doesn't need to be in this array
export const AgentToolsConfigSchema = z.object({
  enabledTools: z.array(z.enum([TOOL_TYPES.WEB_SEARCH, TOOL_TYPES.GOOGLE_CALENDAR, TOOL_TYPES.END_CALL])).default([]),
});

export type AgentToolsConfig = z.infer<typeof AgentToolsConfigSchema>;

// ============ OAuth Connections ============

// OAuth provider types
export const OAUTH_PROVIDERS = {
  GOOGLE: 'google',
} as const;

export type OAuthProvider = typeof OAUTH_PROVIDERS[keyof typeof OAUTH_PROVIDERS];

// OAuth connection schema
export const OAuthConnectionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: z.enum([OAUTH_PROVIDERS.GOOGLE]),
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.date().optional(),
  scope: z.string().optional(),
  email: z.string().email().optional(), // Connected account email
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type OAuthConnection = z.infer<typeof OAuthConnectionSchema>;

// OAuth connection status (safe version without tokens)
export interface OAuthConnectionStatus {
  id: string;
  provider: OAuthProvider;
  email?: string;
  isConnected: boolean;
  connectedAt: Date;
}

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
  sttModel: z.enum(['openai/gpt-4o-transcribe', 'openai/whisper-1', 'deepgram/nova-3', 'assemblyai/universal-streaming', 'cartesia/ink-whisper']).default('openai/gpt-4o-transcribe'),
  ttsModel: z.enum(['openai/gpt-4o-mini-tts', 'openai/tts-1', 'openai/tts-1-hd', 'elevenlabs/eleven_turbo_v2_5', 'elevenlabs/eleven_multilingual_v2', 'cartesia/sonic-3', 'cartesia/sonic-2', 'cartesia/sonic-turbo', 'cartesia/sonic']).default('openai/gpt-4o-mini-tts'),
  tools: z.array(z.string()).default([]),
  // Sharing settings
  isPublic: z.boolean().default(false),
  shareCode: z.string().min(8).max(16).optional(), // Unique code for sharing
  // Knowledge base settings
  enableKnowledgeBase: z.boolean().default(false),
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
  outboundTrunkId: z.string(), // LiveKit outbound trunk ID (unique per agent)
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

// Helper to get compatible voices for a TTS model
export function getCompatibleVoices(ttsModelId: string) {
  // Extract provider from TTS model ID (e.g., "openai/gpt-4o-mini-tts" -> "openai")
  const provider = ttsModelId.split('/')[0] as 'openai' | 'elevenlabs' | 'cartesia';

  // Filter voices by provider
  let compatibleVoices = [...VOICE_OPTIONS].filter((voice) => voice.provider === provider);

  // For OpenAI, further filter by model compatibility
  if (provider === 'openai') {
    const modelName = ttsModelId.split('/')[1];
    if (modelName === 'gpt-4o-mini-tts') {
      // Only show gpt-4o-mini-tts compatible voices
      compatibleVoices = compatibleVoices.filter((voice) => 'model' in voice && voice.model === 'gpt-4o-mini-tts');
    } else if (modelName === 'tts-1' || modelName === 'tts-1-hd') {
      // Only show legacy compatible voices
      compatibleVoices = compatibleVoices.filter((voice) => 'model' in voice && voice.model === 'legacy');
    }
  }

  return compatibleVoices;
}

// Helper to group voices by category
export function groupVoicesByCategory(voices: ReturnType<typeof getCompatibleVoices>) {
  const grouped = new Map<string, any[]>();

  for (const voice of voices) {
    const category = ('category' in voice ? (voice as any).category : (voice as any).provider) as string;
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(voice);
  }

  return grouped;
}

// Available voice options
export const VOICE_OPTIONS = [
  // OpenAI voices for gpt-4o-mini-tts (latest model)
  { id: 'ash', name: 'Ash', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts', category: 'OpenAI' },
  { id: 'ballad', name: 'Ballad', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts', category: 'OpenAI' },
  { id: 'coral', name: 'Coral', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts', category: 'OpenAI' },
  { id: 'sage', name: 'Sage', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts', category: 'OpenAI' },
  { id: 'verse', name: 'Verse', provider: 'openai', language: 'en-US', model: 'gpt-4o-mini-tts', category: 'OpenAI' },
  // OpenAI voices for tts-1 and tts-1-hd (legacy models)
  { id: 'alloy', name: 'Alloy', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  { id: 'echo', name: 'Echo', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  { id: 'fable', name: 'Fable', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  { id: 'onyx', name: 'Onyx', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  { id: 'nova', name: 'Nova', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  { id: 'shimmer', name: 'Shimmer', provider: 'openai', language: 'en-US', model: 'legacy', category: 'OpenAI Legacy' },
  // ElevenLabs English voices
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  // ElevenLabs Indian English voices
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', provider: 'elevenlabs', language: 'en-IN', category: 'ElevenLabs' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', provider: 'elevenlabs', language: 'en-IN', category: 'ElevenLabs' },
  // ElevenLabs Hindi voices (use with eleven_multilingual_v2)
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', provider: 'elevenlabs', language: 'hi-IN', category: 'ElevenLabs' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', provider: 'elevenlabs', language: 'hi-IN', category: 'ElevenLabs' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', provider: 'elevenlabs', language: 'en-GB', category: 'ElevenLabs' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', provider: 'elevenlabs', language: 'en-US', category: 'ElevenLabs' },
  // Cartesia voices
  { id: 'a167e0f3-df7e-4d52-a9c3-f949145efdab', name: 'Customer Support Man', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', name: 'Katie', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '228fca29-3a0a-435c-8728-5cb483251068', name: 'Kiefer', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '694f9389-aac1-45b6-b726-9d9369183238', name: 'Sarah', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '00a77add-48d5-4ef6-8157-71e5437b282d', name: 'Calm Lady', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '156fb8d2-335b-4950-9cb3-a2d33befec77', name: 'Helpful Woman', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: 'b7d50908-b17c-442d-ad8d-810c63997ed9', name: 'California Girl', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '4f8651b0-bbbd-46ac-8b37-5168c5923303', name: 'Kentucky Woman', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '79a125e8-cd45-4c13-8a67-188112f4dd22', name: 'British Lady', provider: 'cartesia', language: 'en-GB', category: 'Cartesia' },
  { id: 'd46abd1d-2d02-43e8-819f-51fb652c1c61', name: 'Newsman', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
  { id: '69267136-1bdc-412f-ad78-0caad210fb40', name: 'Friendly Reading Man', provider: 'cartesia', language: 'en-US', category: 'Cartesia' },
] as const;

// Available model options
export const LLM_OPTIONS = [
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
] as const;

export const STT_OPTIONS = [
  { id: 'openai/gpt-4o-transcribe', name: 'GPT-4o Transcribe - Streaming', provider: 'openai' },
  { id: 'openai/whisper-1', name: 'Whisper-1', provider: 'openai' },
  { id: 'deepgram/nova-3', name: 'Nova 3', provider: 'deepgram' },
  { id: 'assemblyai/universal-streaming', name: 'Universal - Streaming', provider: 'assemblyai' },
  { id: 'cartesia/ink-whisper', name: 'Ink-Whisper - 99 Languages', provider: 'cartesia', languages: ['en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi', 'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'hu', 'ta', 'no', 'th', 'ur', 'hr', 'bg', 'lt', 'la', 'mi', 'ml', 'cy', 'sk', 'te', 'fa', 'lv', 'bn', 'sr', 'az', 'sl', 'kn', 'et', 'mk', 'br', 'eu', 'is', 'hy', 'ne', 'mn', 'bs', 'kk', 'sq', 'sw', 'gl', 'mr', 'pa', 'si', 'km', 'sn', 'yo', 'so', 'af', 'oc', 'ka', 'be', 'tg', 'sd', 'gu', 'am', 'yi', 'lo', 'uz', 'fo', 'ht', 'ps', 'tk', 'mt', 'sa', 'lb', 'my', 'bo', 'tl', 'mg', 'as', 'tt', 'haw', 'ln', 'ha', 'ba'] },
] as const;

export const TTS_OPTIONS = [
  { id: 'openai/gpt-4o-mini-tts', name: 'GPT-4o Mini TTS - Latest', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'openai/tts-1', name: 'TTS-1 Standard', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'openai/tts-1-hd', name: 'TTS-1 HD - Higher Quality', provider: 'openai', languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'ar', 'zh', 'ja', 'hi', 'ko'] },
  { id: 'elevenlabs/eleven_turbo_v2_5', name: 'Turbo v2.5', provider: 'elevenlabs', languages: ['en'] },
  { id: 'elevenlabs/eleven_multilingual_v2', name: 'Multilingual v2', provider: 'elevenlabs', languages: ['en', 'hi', 'ta', 'de', 'fr', 'es', 'ja', 'zh', 'ko', 'pt', 'it', 'ar', 'ru'] },
  { id: 'cartesia/sonic-3', name: 'Sonic 3 - 43 Languages', provider: 'cartesia', languages: ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh', 'hi', 'ko', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'] },
  { id: 'cartesia/sonic-2', name: 'Sonic 2', provider: 'cartesia', languages: ['en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko', 'nl', 'pl', 'ru', 'sv', 'tr'] },
  { id: 'cartesia/sonic-turbo', name: 'Sonic Turbo - Fast', provider: 'cartesia', languages: ['en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko', 'nl', 'pl', 'ru', 'sv', 'tr'] },
  { id: 'cartesia/sonic', name: 'Sonic - Original', provider: 'cartesia', languages: ['en', 'fr', 'de', 'es', 'pt', 'zh', 'ja', 'hi', 'it', 'ko', 'nl', 'pl', 'ru', 'sv', 'tr'] },
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

// ============ Knowledge Base ============

// Knowledge base document schema
export const KnowledgeBaseDocumentSchema = z.object({
  id: z.string().uuid(),
  agentConfigId: z.string().uuid(),
  documentName: z.string().min(1).max(255),
  documentType: z.enum(['pdf', 'txt', 'md', 'json']),
  fileUrl: z.string().url().optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  chunkCount: z.number().int().nonnegative().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type KnowledgeBaseDocument = z.infer<typeof KnowledgeBaseDocumentSchema>;

// Create knowledge base document request
export const CreateKnowledgeBaseDocumentRequestSchema = z.object({
  documentName: z.string().min(1).max(255),
  documentType: z.enum(['pdf', 'txt', 'md', 'json']),
  fileUrl: z.string().url().optional(),
  fileSizeBytes: z.number().int().positive().optional(),
});

export type CreateKnowledgeBaseDocumentRequest = z.infer<typeof CreateKnowledgeBaseDocumentRequestSchema>;

// Knowledge base document status response (safe version)
export interface KnowledgeBaseDocumentStatus {
  id: string;
  agentConfigId: string;
  documentName: string;
  documentType: 'pdf' | 'txt' | 'md' | 'json';
  fileSizeBytes?: number;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  llm,
  metrics,
  stt,
  voice,
} from '@livekit/agents';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import {
  BackgroundVoiceCancellation,
  TelephonyBackgroundVoiceCancellation,
} from '@livekit/noise-cancellation-node';
import type { RoomMetadata } from '@studio/shared';
import { RoomMetadataSchema, TOOL_TYPES } from '@studio/shared';
import dotenv from 'dotenv';
import { RoomServiceClient } from 'livekit-server-sdk';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: '.env.local' });

// Agent configuration interface
interface AgentRuntimeConfig {
  instructions: string;
  voice: string;
  voiceInstructions?: string;
  greeting: string;
  model: string;
  sttModel: string;
  ttsModel: string;
  tools: string[];
  userId: string;
}

// Default configuration when no metadata is provided
const DEFAULT_CONFIG: Omit<AgentRuntimeConfig, 'userId'> = {
  instructions: `You are a helpful voice AI assistant. The user is interacting with you via voice.
    You eagerly assist users with their questions by providing information from your extensive knowledge.
    Your responses are concise, to the point, and without any complex formatting.
    You are curious, friendly, and have a sense of humor.`,
  voice: 'ash',
  greeting: 'Hello! How can I help you today?',
  model: 'gpt-4.1-mini',
  sttModel: 'openai/gpt-4o-transcribe',
  ttsModel: 'openai/gpt-4o-mini-tts',
  tools: [], // END_CALL is always added automatically
};

// Helper function to hang up the call
async function hangupCall(roomName: string) {
  const roomServiceClient = new RoomServiceClient(
    process.env.LIVEKIT_URL!,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!
  );
  await roomServiceClient.deleteRoom(roomName);
}

// Helper function to check if participant is a SIP (phone) participant
function isSipParticipant(participant: { identity: string }): boolean {
  // SIP participants can have identity starting with 'sip_' or '+' (phone number)
  return participant.identity.startsWith('sip_') || participant.identity.startsWith('+');
}

// Extended room metadata for telephony
interface ExtendedRoomMetadata extends RoomMetadata {
  isOutboundCall?: boolean;
  toPhoneNumber?: string;
  type?: string; // Add type field for telephony calls
}

// Parse room metadata to get agent configuration
function parseRoomMetadata(metadata: string | undefined): ExtendedRoomMetadata | null {
  if (!metadata) return null;

  try {
    const parsed = JSON.parse(metadata);
    // For telephony, metadata might come from dispatch rule (simplified)
    // or from API (full RoomMetadata)
    const result = RoomMetadataSchema.safeParse(parsed);
    if (result.success) {
      return {
        ...result.data,
        isOutboundCall: parsed.isOutboundCall,
        toPhoneNumber: parsed.toPhoneNumber,
      };
    }
    // For inbound telephony calls, dispatch rule only has agentConfigId
    if (parsed.agentConfigId) {
      console.log('Telephony dispatch metadata:', parsed);
      return parsed as ExtendedRoomMetadata;
    }
    console.warn('Invalid room metadata schema:', result.error);
    return null;
  } catch (error) {
    console.warn('Failed to parse room metadata:', error);
    return null;
  }
}

// Create a personalized Assistant class based on configuration
function createAssistant(roomName: string, config: AgentRuntimeConfig) {
  // Build tools object based on configuration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  // Always add end_call tool (enabled by default for all agents)
  tools.end_call = llm.tool({
    description: 'End the current call when the user wants to hang up or says goodbye',
    execute: async () => {
      setTimeout(async () => {
        await hangupCall(roomName);
      }, 1000);
      return 'Ending the call now. Goodbye!';
    },
  });

  // Add web search tool if enabled
  if (config.tools.includes(TOOL_TYPES.WEB_SEARCH) && process.env.PERPLEXITY_API_KEY) {
    tools.web_search = llm.tool({
      description:
        'Retrieve raw, ranked search results from the web. Returns structured data with titles, URLs, snippets, and dates. Use for current events, recent news, weather, stock prices, sports scores, or any real-time information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web. Be specific and include context/timeframes.',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of search results to return (1-5, default: 5)',
          },
        },
        required: ['query'],
      },
      execute: async ({ query, max_results = 5 }: { query: string; max_results?: number }) => {
        try {
          console.log(`[WebSearch] Searching for: ${query} (max_results: ${max_results})`);

          const response = await fetch('https://api.perplexity.ai/search', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              max_results: Math.min(Math.max(max_results, 1), 5), // Clamp between 1-5
              max_tokens_per_page: 512,
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[WebSearch] API error (${response.status}): ${errorText}`);
            return 'Sorry, I couldn\'t search the web right now. Please try again.';
          }

          const data = await response.json() as {
            results?: Array<{
              title: string;
              url: string;
              snippet: string;
              date?: string;
              last_updated?: string;
            }>;
          };

          if (!data.results || data.results.length === 0) {
            return 'No search results found for your query.';
          }

          // Format results as a readable string for the LLM
          const formattedResults = data.results
            .map((result, index) => {
              const dateInfo = result.date || result.last_updated || 'Date unavailable';
              return `${index + 1}. ${result.title}\n   URL: ${result.url}\n   Date: ${dateInfo}\n   ${result.snippet}`;
            })
            .join('\n\n');

          return `Found ${data.results.length} search results:\n\n${formattedResults}`;
        } catch (error) {
          console.error('[WebSearch] Error:', error);
          return 'Sorry, there was an error searching the web.';
        }
      },
    });
  }

  // Add Google Calendar tools if enabled
  if (config.tools.includes(TOOL_TYPES.GOOGLE_CALENDAR)) {
    const userId = config.userId;
    const apiUrl = process.env.API_URL || 'http://localhost:3001';

    tools.list_calendar_events = llm.tool({
      description: 'List upcoming calendar events from the user\'s Google Calendar. Use when the user asks about their schedule.',
      parameters: {
        type: 'object',
        properties: {
          maxResults: { type: 'number', description: 'Maximum number of events (default 5)' },
        },
      },
      execute: async ({ maxResults = 5 }: { maxResults?: number }) => {
        try {
          // Get access token from API
          const tokenRes = await fetch(`${apiUrl}/api/internal/oauth/${userId}/google`, {
            headers: { 'x-api-key': process.env.LIVEKIT_API_SECRET! },
          });
          if (!tokenRes.ok) return 'Cannot access your calendar. Please connect Google Calendar in settings.';
          const { accessToken } = await tokenRes.json() as { accessToken: string };

          // Fetch calendar events
          const params = new URLSearchParams({
            maxResults: String(Math.min(maxResults, 10)),
            timeMin: new Date().toISOString(),
            orderBy: 'startTime',
            singleEvents: 'true',
          });
          const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!calRes.ok) return 'Error accessing your calendar.';

          const data = await calRes.json() as { items: Array<{ summary: string; start: { dateTime?: string; date?: string } }> };
          if (!data.items?.length) return 'You have no upcoming events.';

          return 'Here are your upcoming events:\n' + data.items.map((e, i) => {
            const time = e.start.dateTime ? new Date(e.start.dateTime).toLocaleString() : e.start.date;
            return `${i + 1}. ${e.summary}: ${time}`;
          }).join('\n');
        } catch (error) {
          console.error('[Calendar] Error:', error);
          return 'Error accessing calendar.';
        }
      },
    });

    tools.create_calendar_event = llm.tool({
      description: 'Create a new event on the user\'s Google Calendar.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          startTime: { type: 'string', description: 'Start time in ISO format' },
          endTime: { type: 'string', description: 'End time (optional, defaults to 1 hour)' },
          description: { type: 'string', description: 'Event description (optional)' },
        },
        required: ['summary', 'startTime'],
      },
      execute: async ({ summary, startTime, endTime, description }: { summary: string; startTime: string; endTime?: string; description?: string }) => {
        try {
          const tokenRes = await fetch(`${apiUrl}/api/internal/oauth/${userId}/google`, {
            headers: { 'x-api-key': process.env.LIVEKIT_API_SECRET! },
          });
          if (!tokenRes.ok) return 'Cannot access your calendar. Please connect Google Calendar in settings.';
          const { accessToken } = await tokenRes.json() as { accessToken: string };

          const start = new Date(startTime);
          const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);

          const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              summary,
              description,
              start: { dateTime: start.toISOString(), timeZone: 'UTC' },
              end: { dateTime: end.toISOString(), timeZone: 'UTC' },
            }),
          });
          if (!calRes.ok) return 'Error creating event.';

          const created = await calRes.json() as { summary: string; start: { dateTime: string } };
          return `Created "${created.summary}" for ${new Date(created.start.dateTime).toLocaleString()}.`;
        } catch (error) {
          console.error('[Calendar] Error:', error);
          return 'Error creating event.';
        }
      },
    });
  }

  console.log('[Agent] Enabled tools:', Object.keys(tools));

  return new (class extends voice.Agent {
    constructor() {
      super({
        instructions: config.instructions,
        tools,
      });
    }
  })();
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    console.log('[Agent] Entry called for room:', ctx.room.name);
    console.log('[Agent] Room metadata:', ctx.room.metadata);

    // Connect to the room first to access metadata
    await ctx.connect();
    console.log('[Agent] Connected to room successfully');

    // Parse room metadata for personalized configuration
    const roomMetadata = parseRoomMetadata(ctx.room.metadata);
    let agentConfig = roomMetadata?.agentConfig;
    const isOutboundCall = roomMetadata?.isOutboundCall ?? false;

    console.log('[Agent] Parsed metadata:', {
      hasAgentConfig: !!agentConfig,
      agentConfigId: roomMetadata?.agentConfigId,
      isOutboundCall,
      type: roomMetadata?.type,
    });

    // For telephony calls, fetch agent config from API if we only have the ID
    if (!agentConfig && roomMetadata?.agentConfigId) {
      console.log(`Fetching agent config for telephony call: ${roomMetadata.agentConfigId}`);
      try {
        const apiUrl = process.env.API_URL || 'http://localhost:3001';
        const response = await fetch(`${apiUrl}/api/internal/agents/${roomMetadata.agentConfigId}`, {
          headers: {
            'x-api-key': process.env.LIVEKIT_API_SECRET!,
          },
        });

        if (response.ok) {
          const data = await response.json();
          agentConfig = data;
          console.log('Successfully fetched agent config from API');
        } else {
          console.error('Failed to fetch agent config:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Error fetching agent config:', error);
      }
    }

    // Check for telephony call - either from metadata or by checking participants
    const participants = ctx.room.remoteParticipants;
    const hasSipParticipant = Array.from(participants.values()).some((p) => isSipParticipant(p));
    // Also check if this is an outbound call (telephony) or if room has telephony metadata
    const isTelephonyCall = isOutboundCall || hasSipParticipant || !!roomMetadata?.agentConfigId;

    // Merge with defaults
    const config: AgentRuntimeConfig = {
      instructions: agentConfig?.instructions ?? DEFAULT_CONFIG.instructions,
      voice: agentConfig?.voice ?? DEFAULT_CONFIG.voice,
      voiceInstructions: agentConfig?.voiceInstructions,
      greeting: agentConfig?.greeting ?? DEFAULT_CONFIG.greeting,
      model: agentConfig?.model ?? DEFAULT_CONFIG.model,
      sttModel: agentConfig?.sttModel ?? DEFAULT_CONFIG.sttModel,
      ttsModel: agentConfig?.ttsModel ?? DEFAULT_CONFIG.ttsModel,
      tools: agentConfig?.tools ?? DEFAULT_CONFIG.tools,
      userId: roomMetadata?.userId ?? 'unknown',
    };

    console.log('Starting agent with config:', {
      model: config.model,
      sttModel: config.sttModel,
      ttsModel: config.ttsModel,
      tools: config.tools,
      hasCustomInstructions: !!agentConfig?.instructions,
      isTelephonyCall,
      isOutboundCall,
    });

    // Map TTS model to provider
    let ttsProvider: any;
    if (config.ttsModel.startsWith('openai/')) {
      const modelName = config.ttsModel.replace('openai/', '');

      // Legacy OpenAI TTS models (tts-1, tts-1-hd) use different voices than gpt-4o-mini-tts
      if (modelName === 'tts-1' || modelName === 'tts-1-hd') {
        // Legacy voices: alloy, echo, fable, onyx, nova, shimmer
        const legacyVoiceMap: Record<string, string> = {
          'alloy': 'alloy',
          'echo': 'echo',
          'fable': 'fable',
          'onyx': 'onyx',
          'nova': 'nova',
          'shimmer': 'shimmer',
        };
        const voiceName = legacyVoiceMap[config.voice] || 'alloy';

        ttsProvider = new openai.TTS({
          model: modelName,
          voice: voiceName as any,
        });
      } else if (modelName === 'gpt-4o-mini-tts') {
        // Latest model uses new voices: ash, ballad, coral, sage, verse
        // Also supports instructions parameter
        const newVoiceMap: Record<string, string> = {
          'ash': 'ash',
          'ballad': 'ballad',
          'coral': 'coral',
          'sage': 'sage',
          'verse': 'verse',
        };
        const voiceName = newVoiceMap[config.voice] || 'ash';

        ttsProvider = new openai.TTS({
          model: 'gpt-4o-mini-tts',
          voice: voiceName as any,
          instructions: config.voiceInstructions || 'Speak in a natural, conversational tone.',
        });
      } else {
        // Default to gpt-4o-mini-tts if model not recognized
        console.warn(`[Agent] Unknown OpenAI TTS model ${modelName}, defaulting to gpt-4o-mini-tts`);
        ttsProvider = new openai.TTS({
          model: 'gpt-4o-mini-tts',
          voice: 'ash',
          instructions: 'Speak in a natural, conversational tone.',
        });
      }
    } else {
      // Default to OpenAI if provider not recognized
      console.warn(`[Agent] TTS model ${config.ttsModel} not supported, using OpenAI gpt-4o-mini-tts`);
      ttsProvider = new openai.TTS({
        model: 'gpt-4o-mini-tts',
        voice: 'ash',
        instructions: 'Speak in a natural, conversational tone.',
      });
    }

    // Map STT model to provider
    // Note: gpt-4o-transcribe supports native streaming, whisper-1 requires StreamAdapter
    let sttProvider: any;
    const vad = ctx.proc.userData.vad as silero.VAD;
    if (config.sttModel.startsWith('openai/')) {
      const modelName = config.sttModel.replace('openai/', '');

      if (modelName === 'gpt-4o-transcribe') {
        // gpt-4o-transcribe supports native streaming - use directly without StreamAdapter
        sttProvider = new openai.STT({
          model: 'gpt-4o-transcribe',
        });
      } else {
        // whisper-1 doesn't support streaming - wrap with StreamAdapter
        const openaiSTT = new openai.STT({
          model: modelName,
        });
        sttProvider = new stt.StreamAdapter(openaiSTT, vad);
      }
    } else {
      // Default to gpt-4o-transcribe if other provider selected (not yet supported)
      console.warn(`[Agent] STT model ${config.sttModel} not supported, using OpenAI gpt-4o-transcribe`);
      sttProvider = new openai.STT({
        model: 'gpt-4o-transcribe',
      });
    }

    // Create the voice session with personalized models
    const session = new voice.AgentSession({
      stt: sttProvider,
      llm: new openai.LLM({
        model: config.model,
      }),
      tts: ttsProvider,
      turnDetection: new livekit.turnDetector.MultilingualModel(),
      // VAD is needed for interruption handling (used directly for gpt-4o-transcribe, via StreamAdapter for whisper-1)
      vad: vad,
    });

    // Metrics collection
    const usageCollector = new metrics.UsageCollector();
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      metrics.logMetrics(ev.metrics);
      usageCollector.collect(ev.metrics);
    });

    const logUsage = async () => {
      const summary = usageCollector.getSummary();
      console.log(`Usage: ${JSON.stringify(summary)}`);
    };

    ctx.addShutdownCallback(logUsage);

    // Start the session with personalized assistant
    await session.start({
      agent: createAssistant(ctx.room.name!, config),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: isTelephonyCall
          ? TelephonyBackgroundVoiceCancellation()
          : BackgroundVoiceCancellation(),
      },
    });

    // Generate personalized greeting
    // For outbound calls, wait for SIP participant to join before greeting
    // For inbound calls and web calls, greet immediately
    if (config.greeting) {
      if (!isOutboundCall) {
        // Inbound/web calls: greet immediately
        session.generateReply({
          instructions: config.greeting,
        });
      } else {
        // Outbound calls: Wait for SIP participant to join
        console.log('[Agent] Waiting for SIP participant to join before greeting');

        // Check if SIP participant is already in the room
        const checkForSipParticipant = () => {
          const sipParticipant = Array.from(ctx.room.remoteParticipants.values())
            .find(p => p.identity.startsWith('sip_') || p.identity.startsWith('+'));

          if (sipParticipant) {
            console.log('[Agent] SIP participant joined:', sipParticipant.identity);
            // Wait a bit more to ensure audio connection is established
            setTimeout(() => {
              console.log('[Agent] Sending greeting for outbound call');
              session.generateReply({
                instructions: config.greeting || 'Hello! This is a call from your AI assistant. How can I help you today?',
              });
            }, 1500); // 1.5 second delay after SIP participant joins
            return true;
          }
          return false;
        };

        // Check immediately
        if (!checkForSipParticipant()) {
          // If not present, listen for participant joined event
          const participantHandler = (participant: any) => {
            if (participant.identity.startsWith('sip_') || participant.identity.startsWith('+')) {
              console.log('[Agent] SIP participant joined:', participant.identity);
              ctx.room.off('participantConnected', participantHandler);
              // Wait a bit for audio connection to establish
              setTimeout(() => {
                console.log('[Agent] Sending greeting for outbound call');
                session.generateReply({
                  instructions: config.greeting || 'Hello! This is a call from your AI assistant. How can I help you today?',
                });
              }, 1500);
            }
          };
          ctx.room.on('participantConnected', participantHandler);

          // Fallback timeout in case something goes wrong
          setTimeout(() => {
            ctx.room.off('participantConnected', participantHandler);
            if (!checkForSipParticipant()) {
              console.log('[Agent] No SIP participant after 10 seconds, sending greeting anyway');
              session.generateReply({
                instructions: config.greeting || 'Hello! This is a call from your AI assistant. How can I help you today?',
              });
            }
          }, 10000); // 10 second fallback
        }
      }
    }
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Agent name for telephony explicit dispatch
    agentName: 'studio-voice-agent',
    // Auto-accept jobs for rooms with agentConfigId in metadata
    requestFunc: async (request: any) => {
      console.log('[Agent] Job request received:', request.room.name);

      // Parse room metadata
      try {
        const metadata = request.room.metadata ? JSON.parse(request.room.metadata) : {};

        // Auto-accept if room has agentConfigId (telephony calls)
        if (metadata.agentConfigId) {
          console.log('[Agent] Auto-accepting job for room with agentConfigId:', metadata.agentConfigId);
          await request.accept(); // Accept the job
          return;
        }

        // Also accept if explicitly requested by name
        if (request.agentName === 'studio-voice-agent') {
          console.log('[Agent] Auto-accepting job for explicit agent request');
          await request.accept();
          return;
        }
      } catch (e) {
        console.log('[Agent] Error parsing metadata, accepting job anyway');
        await request.accept(); // Accept on error to be safe
        return;
      }

      // Default: accept all jobs (you can change this to false if needed)
      await request.accept();
    },
  })
);

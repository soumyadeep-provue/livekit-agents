# Studio Voice AI Platform

A multi-tenant voice AI platform built with LiveKit Agents. Users can create, customize, and share personalized voice AI assistants.

## Features

- **Multi-tenant Voice Agents**: Create personalized voice AI assistants with custom:
  - Instructions/personality
  - Voice selection (ElevenLabs voices)
  - STT model (Deepgram Nova-3, AssemblyAI)
  - TTS model (ElevenLabs, Cartesia)
  - LLM model (GPT-4.1-mini, GPT-4.1, GPT-4o)

- **Public Sharing**: Share your agents via link - anyone can talk to them without logging in

- **Web Dashboard**: Create, edit, delete voice agents and start voice calls

- **Telephony Support**: Agent detects SIP participants and uses appropriate noise cancellation

## Project Structure

```
studio-voice-platform/
├── apps/
│   ├── agent/          # LiveKit Voice Agent
│   ├── api/            # Backend API Server
│   └── web/            # React Web Frontend
├── packages/
│   └── shared/         # Shared types and schemas
└── package.json        # Workspace root
```

## Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- [LiveKit Cloud](https://cloud.livekit.io/) account

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**

   Copy `.env.local.example` to `.env.local` in the root directory:
   ```bash
   cp .env.local.example .env.local
   ```

   Fill in your LiveKit credentials:
   ```
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-api-key
   LIVEKIT_API_SECRET=your-api-secret
   ```

3. **Copy environment to apps:**
   ```bash
   cp .env.local apps/agent/.env.local
   cp .env.local apps/api/.env.local
   ```

4. **Download required model files:**
   ```bash
   pnpm run download-files
   ```

## Development

**Run all services:**
```bash
pnpm dev
```

Or run individually:
```bash
pnpm dev:api      # API server on http://localhost:3001
pnpm dev:web      # Web frontend on http://localhost:3000
pnpm dev:agent    # Voice agent
```

## Usage

1. Open http://localhost:3000
2. Create a new voice agent with custom instructions
3. Click "Start Call" to talk to your agent
4. Enable "Public Sharing" to get a shareable link

## Sharing Agents

1. Edit an agent and toggle "Enable Public Sharing"
2. Copy the generated share link
3. Anyone with the link can visit and talk to your agent without logging in

## Build

```bash
pnpm build
```

## License

MIT

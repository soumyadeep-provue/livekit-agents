import { useState } from 'react';

import type { AgentConfig, CreateAgentConfigRequest, UpdateAgentConfigRequest } from '@studio/shared';
import { LLM_OPTIONS, STT_OPTIONS, TTS_OPTIONS, VOICE_OPTIONS } from '@studio/shared';

import { TelephonySettings } from './TelephonySettings';
import { ToolsSettings } from './ToolsSettings';
import { api } from '../lib/api';

interface AgentFormProps {
  agent?: AgentConfig;
  userId?: string;
  onSubmit: (data: CreateAgentConfigRequest) => void;
  onCancel: () => void;
}

export function AgentForm({ agent, userId, onSubmit, onCancel }: AgentFormProps) {
  const [formData, setFormData] = useState<CreateAgentConfigRequest>({
    name: agent?.name ?? '',
    instructions: agent?.instructions ?? '',
    voice: agent?.voice ?? 'ash',
    greeting: agent?.greeting ?? '',
    model: agent?.model ?? 'gpt-4.1-mini',
    sttModel: agent?.sttModel ?? 'openai/gpt-4o-transcribe',
    ttsModel: agent?.ttsModel ?? 'openai/gpt-4o-mini-tts',
    tools: agent?.tools ?? [],
    isPublic: agent?.isPublic ?? false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div className="modal-header">
        <h2>{agent ? 'Edit Agent' : 'Create New Agent'}</h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Agent Name</label>
          <input
            type="text"
            className="form-input"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="My Assistant"
            required
          />
        </div>

        <div className="form-group">
          <label className="form-label">Instructions</label>
          <textarea
            className="form-textarea"
            value={formData.instructions}
            onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
            placeholder="You are a helpful voice assistant..."
            required
          />
          <small style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
            Define your agent's personality, knowledge, and behavior
          </small>
        </div>

        <div className="form-group">
          <label className="form-label">Greeting Message</label>
          <input
            type="text"
            className="form-input"
            value={formData.greeting}
            onChange={(e) => setFormData({ ...formData, greeting: e.target.value })}
            placeholder="Hello! How can I help you today?"
          />
          <small style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
            What the agent says when the call starts
          </small>
        </div>

        <div className="form-group">
          <label className="form-label">Voice</label>
          <select
            className="form-select"
            value={formData.voice}
            onChange={(e) => setFormData({ ...formData, voice: e.target.value })}
          >
            {VOICE_OPTIONS.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.provider})
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Voice Instructions (Optional)</label>
          <input
            type="text"
            className="form-input"
            value={formData.voiceInstructions || ''}
            onChange={(e) => setFormData({ ...formData, voiceInstructions: e.target.value })}
            placeholder="Speak in a cheerful, energetic tone"
          />
          <small style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
            Control tone and style (works with OpenAI GPT-4o Mini TTS only)
          </small>
        </div>

        <div className="form-group">
          <label className="form-label">LLM Model</label>
          <select
            className="form-select"
            value={formData.model}
            onChange={(e) =>
              setFormData({ ...formData, model: e.target.value as CreateAgentConfigRequest['model'] })
            }
          >
            {LLM_OPTIONS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Speech-to-Text Model</label>
          <select
            className="form-select"
            value={formData.sttModel}
            onChange={(e) =>
              setFormData({ ...formData, sttModel: e.target.value as CreateAgentConfigRequest['sttModel'] })
            }
          >
            {STT_OPTIONS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Text-to-Speech Model</label>
          <select
            className="form-select"
            value={formData.ttsModel}
            onChange={(e) =>
              setFormData({ ...formData, ttsModel: e.target.value as CreateAgentConfigRequest['ttsModel'] })
            }
          >
            {TTS_OPTIONS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem',
          background: 'var(--bg-tertiary)',
          borderRadius: '0.5rem'
        }}>
          <input
            type="checkbox"
            id="isPublic"
            checked={formData.isPublic}
            onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
            style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer' }}
          />
          <div>
            <label htmlFor="isPublic" style={{ cursor: 'pointer', fontWeight: 500 }}>
              Enable Public Sharing
            </label>
            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.25rem' }}>
              Anyone with the link can interact with this agent
            </small>
          </div>
        </div>

        {agent?.isPublic && agent?.shareCode && (
          <div className="form-group" style={{
            padding: '1rem',
            background: 'rgba(99, 102, 241, 0.1)',
            borderRadius: '0.5rem',
            border: '1px solid var(--primary)'
          }}>
            <label className="form-label" style={{ color: 'var(--primary)' }}>Share Link</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                className="form-input"
                value={`${window.location.origin}/share/${agent.shareCode}`}
                readOnly
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/share/${agent.shareCode}`);
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {agent ? 'Save Changes' : 'Create Agent'}
          </button>
        </div>
      </form>

      {/* Telephony settings - only shown when editing an existing agent */}
      {agent && userId && (
        <TelephonySettings
          userId={userId}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}

      {/* Tools settings - only shown when editing an existing agent */}
      {agent && userId && (
        <ToolsSettings
          userId={userId}
          enabledTools={formData.tools || []}
          onUpdate={async (data: UpdateAgentConfigRequest) => {
            const updated = await api.updateAgent(userId, agent.id, data);
            setFormData(prev => ({ ...prev, tools: updated.tools }));
          }}
        />
      )}
    </div>
  );
}

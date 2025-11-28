import { useState, useEffect } from 'react';

import type { AgentConfig, TokenResponse } from '@studio/shared';

import { AgentForm } from './components/AgentForm';
import { SharePage } from './components/SharePage';
import { VoiceRoom } from './components/VoiceRoom';
import { api } from './lib/api';

type View = 'dashboard' | 'voice-room' | 'create-agent' | 'edit-agent' | 'share';

interface AppState {
  view: View;
  userId: string | null;
  agents: AgentConfig[];
  selectedAgent: AgentConfig | null;
  connectionInfo: TokenResponse | null;
  loading: boolean;
  error: string | null;
  shareCode: string | null;
}

// Simple URL-based routing helper
function getShareCodeFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/share\/([A-Za-z0-9]+)$/);
  return match ? match[1] : null;
}

export default function App() {
  const shareCode = getShareCodeFromUrl();

  const [state, setState] = useState<AppState>({
    view: shareCode ? 'share' : 'dashboard',
    userId: null,
    agents: [],
    selectedAgent: null,
    connectionInfo: null,
    loading: !shareCode, // Don't show loading if we're on share page
    error: null,
    shareCode,
  });

  // Initialize user on mount (skip if on share page)
  useEffect(() => {
    if (!shareCode) {
      initializeUser();
    }
  }, [shareCode]);

  const initializeUser = async () => {
    try {
      // For demo, use a test user
      const user = await api.getOrCreateUser('test@example.com', 'Test User');
      setState((prev) => ({ ...prev, userId: user.id }));
      await loadAgents(user.id);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to initialize user',
        loading: false,
      }));
    }
  };

  const loadAgents = async (userId: string) => {
    try {
      setState((prev) => ({ ...prev, loading: true }));
      const agents = await api.listAgents(userId);
      setState((prev) => ({ ...prev, agents, loading: false }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to load agents',
        loading: false,
      }));
    }
  };

  const handleCreateAgent = async (data: Parameters<typeof api.createAgent>[1]) => {
    if (!state.userId) return;
    try {
      const agent = await api.createAgent(state.userId, data);
      setState((prev) => ({
        ...prev,
        agents: [...prev.agents, agent],
        view: 'dashboard',
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: 'Failed to create agent' }));
    }
  };

  const handleUpdateAgent = async (data: Parameters<typeof api.updateAgent>[2]) => {
    if (!state.userId || !state.selectedAgent) return;
    try {
      const updated = await api.updateAgent(state.userId, state.selectedAgent.id, data);
      setState((prev) => ({
        ...prev,
        agents: prev.agents.map((a) => (a.id === updated.id ? updated : a)),
        view: 'dashboard',
        selectedAgent: null,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: 'Failed to update agent' }));
    }
  };

  const handleDeleteAgent = async (agentId: string) => {
    if (!state.userId) return;
    if (!confirm('Are you sure you want to delete this agent?')) return;
    try {
      await api.deleteAgent(state.userId, agentId);
      setState((prev) => ({
        ...prev,
        agents: prev.agents.filter((a) => a.id !== agentId),
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: 'Failed to delete agent' }));
    }
  };

  const handleStartCall = async (agent: AgentConfig) => {
    if (!state.userId) return;
    try {
      setState((prev) => ({ ...prev, loading: true }));
      const connectionInfo = await api.getToken(state.userId, agent.id);
      setState((prev) => ({
        ...prev,
        connectionInfo,
        selectedAgent: agent,
        view: 'voice-room',
        loading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: 'Failed to start call',
        loading: false,
      }));
    }
  };

  const handleEndCall = () => {
    setState((prev) => ({
      ...prev,
      view: 'dashboard',
      connectionInfo: null,
      selectedAgent: null,
    }));
  };

  // Handle share page view
  if (state.view === 'share' && state.shareCode) {
    return (
      <SharePage
        shareCode={state.shareCode}
        onBack={() => {
          window.location.href = '/';
        }}
      />
    );
  }

  if (state.loading && !state.userId) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (state.view === 'voice-room' && state.connectionInfo && state.selectedAgent) {
    return (
      <VoiceRoom
        token={state.connectionInfo.token}
        url={state.connectionInfo.url}
        agentName={state.selectedAgent.name}
        onDisconnect={handleEndCall}
      />
    );
  }

  if (state.view === 'create-agent') {
    return (
      <div className="container">
        <AgentForm
          userId={state.userId ?? undefined}
          onSubmit={handleCreateAgent}
          onCancel={() => setState((prev) => ({ ...prev, view: 'dashboard' }))}
        />
      </div>
    );
  }

  if (state.view === 'edit-agent' && state.selectedAgent) {
    return (
      <div className="container">
        <AgentForm
          agent={state.selectedAgent}
          userId={state.userId ?? undefined}
          onSubmit={handleUpdateAgent}
          onCancel={() =>
            setState((prev) => ({ ...prev, view: 'dashboard', selectedAgent: null }))
          }
        />
      </div>
    );
  }

  return (
    <>
      <header className="header">
        <h1>Studio</h1>
        <button
          className="btn btn-primary"
          onClick={() => setState((prev) => ({ ...prev, view: 'create-agent' }))}
        >
          + Create Agent
        </button>
      </header>

      <div className="container">
        {state.error && (
          <div className="card" style={{ background: 'rgba(239, 68, 68, 0.1)', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--error)' }}>{state.error}</p>
            <button
              className="btn btn-secondary"
              onClick={() => setState((prev) => ({ ...prev, error: null }))}
              style={{ marginTop: '0.5rem' }}
            >
              Dismiss
            </button>
          </div>
        )}

        <h2 style={{ marginBottom: '0.5rem' }}>Your Voice Agents</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
          Create and manage personalized voice AI assistants
        </p>

        {state.agents.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>No agents yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Create your first voice agent to get started
            </p>
            <button
              className="btn btn-primary"
              onClick={() => setState((prev) => ({ ...prev, view: 'create-agent' }))}
            >
              Create Agent
            </button>
          </div>
        ) : (
          <div className="agent-grid">
            {state.agents.map((agent) => (
              <div key={agent.id} className="agent-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3>{agent.name}</h3>
                  {agent.isPublic && (
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '0.25rem 0.5rem',
                      background: 'var(--primary)',
                      borderRadius: '9999px',
                      color: 'white'
                    }}>
                      Public
                    </span>
                  )}
                </div>
                <p>{agent.instructions}</p>
                {agent.isPublic && agent.shareCode && (
                  <div style={{
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    marginBottom: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span>Share:</span>
                    <code style={{
                      background: 'var(--bg-tertiary)',
                      padding: '0.125rem 0.375rem',
                      borderRadius: '0.25rem',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/share/${agent.shareCode}`);
                    }}
                    title="Click to copy"
                    >
                      /share/{agent.shareCode}
                    </code>
                  </div>
                )}
                <div className="agent-card-actions">
                  <button className="btn btn-primary" onClick={() => handleStartCall(agent)}>
                    Start Call
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        view: 'edit-agent',
                        selectedAgent: agent,
                      }))
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeleteAgent(agent.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

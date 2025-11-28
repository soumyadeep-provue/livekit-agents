import { useState, useEffect } from 'react';
import { TOOL_TYPES, type UpdateAgentConfigRequest } from '@studio/shared';
import { api } from '../lib/api';

interface Tool {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'needs_auth' | 'needs_api_key';
  connectedEmail?: string;
}

interface ToolsSettingsProps {
  userId: string;
  enabledTools: string[];
  onUpdate: (data: UpdateAgentConfigRequest) => Promise<void>;
}

export function ToolsSettings({
  userId,
  enabledTools,
  onUpdate,
}: ToolsSettingsProps) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>(enabledTools);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadTools();
    // Check for OAuth callback params
    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get('oauth');
    const provider = params.get('provider');
    const message = params.get('message');

    if (oauthStatus === 'success') {
      const providerName = provider === 'google' ? 'Google Calendar' : provider || 'account';
      setSuccess(`🎉 Successfully connected ${providerName}! You can now use calendar features in your agent.`);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      loadTools();
      // Auto-dismiss success message after 8 seconds
      setTimeout(() => setSuccess(null), 8000);
    } else if (oauthStatus === 'error') {
      const errorMessage = message === 'invalid_state'
        ? 'Session expired. Please try connecting again.'
        : message === 'token_exchange_failed'
        ? 'Failed to complete authentication. Please try again.'
        : message || 'Unknown error occurred';
      setError(`Failed to connect: ${errorMessage}`);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [userId]);

  useEffect(() => {
    setSelectedTools(enabledTools);
  }, [enabledTools]);

  const loadTools = async () => {
    setLoading(true);
    try {
      const toolsData = await api.getTools(userId);
      setTools(toolsData);
    } catch (e) {
      console.error('Failed to load tools:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToolToggle = async (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId);

    // Check if tool requires setup
    if (tool?.status === 'needs_auth') {
      // Start OAuth flow
      try {
        const { authUrl } = await api.startGoogleOAuth(userId);
        window.location.href = authUrl;
      } catch (e) {
        setError('Failed to start OAuth flow');
      }
      return;
    }

    if (tool?.status === 'needs_api_key') {
      setError(`${tool.name} requires an API key. Please configure it in the server environment.`);
      return;
    }

    // Toggle tool
    const newSelected = selectedTools.includes(toolId)
      ? selectedTools.filter((t) => t !== toolId)
      : [...selectedTools, toolId];

    setSelectedTools(newSelected);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await onUpdate({ tools: selectedTools });
      setSuccess('Tools configuration saved!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save tools');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm('Are you sure you want to disconnect Google Calendar?')) return;

    try {
      await api.disconnectOAuth(userId, 'google');
      // Remove Google Calendar from selected tools
      setSelectedTools(selectedTools.filter((t) => t !== TOOL_TYPES.GOOGLE_CALENDAR));
      loadTools();
      setSuccess('Google Calendar disconnected');
    } catch (e) {
      setError('Failed to disconnect Google Calendar');
    }
  };

  const hasChanges = JSON.stringify(selectedTools.sort()) !== JSON.stringify(enabledTools.sort());

  if (loading) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="loading">
          <div className="spinner" />
          <p>Loading tools...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginBottom: '1rem' }}>Tools</h3>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
        Enable tools to give your agent additional capabilities like web search and calendar access.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {tools.map((tool) => {
          const isEnabled = selectedTools.includes(tool.id);
          const isAvailable = tool.status === 'available';
          const needsAuth = tool.status === 'needs_auth';
          const needsApiKey = tool.status === 'needs_api_key';

          return (
            <div
              key={tool.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                background: 'var(--bg-tertiary)',
                borderRadius: '0.5rem',
                border: isEnabled ? '1px solid var(--accent-color)' : '1px solid transparent',
              }}
            >
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={() => handleToolToggle(tool.id)}
                disabled={needsApiKey}
                style={{ marginTop: '0.25rem' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 500 }}>{tool.name}</span>
                  {needsAuth && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(234, 179, 8, 0.2)',
                        color: '#eab308',
                      }}
                    >
                      Connect Account
                    </span>
                  )}
                  {needsApiKey && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: '#ef4444',
                      }}
                    >
                      API Key Required
                    </span>
                  )}
                  {isAvailable && tool.connectedEmail && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '0.25rem',
                        background: 'rgba(34, 197, 94, 0.2)',
                        color: '#22c55e',
                      }}
                    >
                      {tool.connectedEmail}
                    </span>
                  )}
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
                  {tool.description}
                </p>
                {tool.id === TOOL_TYPES.GOOGLE_CALENDAR && tool.connectedEmail && (
                  <button
                    onClick={handleDisconnectGoogle}
                    style={{
                      marginTop: '0.5rem',
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.5rem',
                      background: 'transparent',
                      border: '1px solid var(--text-secondary)',
                      borderRadius: '0.25rem',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: '#ef4444',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{
          marginTop: '1rem',
          padding: '0.75rem 1rem',
          borderRadius: '0.5rem',
          background: 'rgba(34, 197, 94, 0.1)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          color: '#22c55e',
          fontSize: '0.875rem',
          fontWeight: 500
        }}>
          {success}
        </div>
      )}

      {hasChanges && (
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
          style={{ marginTop: '1rem', width: '100%' }}
        >
          {saving ? 'Saving...' : 'Save Tools Configuration'}
        </button>
      )}
    </div>
  );
}

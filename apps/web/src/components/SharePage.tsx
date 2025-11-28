import { useEffect, useState } from 'react';

import type { ShareInfoResponse, TokenResponse } from '@studio/shared';

import { api } from '../lib/api';
import { VoiceRoom } from './VoiceRoom';

interface SharePageProps {
  shareCode: string;
  onBack: () => void;
}

type PageState = 'loading' | 'ready' | 'in-call' | 'error';

export function SharePage({ shareCode, onBack }: SharePageProps) {
  const [state, setState] = useState<PageState>('loading');
  const [agentInfo, setAgentInfo] = useState<ShareInfoResponse | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');

  useEffect(() => {
    loadAgentInfo();
  }, [shareCode]);

  const loadAgentInfo = async () => {
    try {
      setState('loading');
      const info = await api.getShareInfo(shareCode);
      setAgentInfo(info);
      setState('ready');
    } catch {
      setError('This shared agent was not found or is no longer available.');
      setState('error');
    }
  };

  const handleStartCall = async () => {
    try {
      setState('loading');
      const connection = await api.getPublicToken(shareCode, guestName || undefined);
      setConnectionInfo(connection);
      setState('in-call');
    } catch {
      setError('Failed to start the call. Please try again.');
      setState('error');
    }
  };

  const handleEndCall = () => {
    setConnectionInfo(null);
    setState('ready');
  };

  if (state === 'in-call' && connectionInfo && agentInfo) {
    return (
      <VoiceRoom
        token={connectionInfo.token}
        url={connectionInfo.url}
        agentName={agentInfo.name}
        onDisconnect={handleEndCall}
      />
    );
  }

  if (state === 'error') {
    return (
      <div className="container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div className="card" style={{ maxWidth: '400px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '1rem' }}>Oops!</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>{error}</p>
          <button className="btn btn-secondary" onClick={onBack}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: '4rem' }}>
      <div className="card" style={{ maxWidth: '450px', margin: '0 auto', textAlign: 'center' }}>
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary), #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1.5rem',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="white"
            style={{ width: '40px', height: '40px' }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
            />
          </svg>
        </div>

        <h2 style={{ marginBottom: '0.5rem' }}>{agentInfo?.name}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          You've been invited to talk with this voice AI assistant
        </p>

        <div className="form-group" style={{ textAlign: 'left' }}>
          <label className="form-label">Your Name (optional)</label>
          <input
            type="text"
            className="form-input"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Guest"
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={handleStartCall}
          style={{ width: '100%', marginTop: '1rem', padding: '1rem' }}
        >
          Start Voice Call
        </button>

      </div>
    </div>
  );
}

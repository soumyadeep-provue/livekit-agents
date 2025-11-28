import { useState, useEffect } from 'react';
import type { TelephonyStatusResponse, CreateTelephonyConfigRequest } from '@studio/shared';
import { api } from '../lib/api';

interface TelephonySettingsProps {
  userId: string;
  agentId: string;
  agentName: string;
}

export function TelephonySettings({ userId, agentId, agentName }: TelephonySettingsProps) {
  const [telephonyConfig, setTelephonyConfig] = useState<TelephonyStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Call Me state
  const [callMeNumber, setCallMeNumber] = useState('');
  const [calling, setCalling] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'error'>('idle');
  const [callError, setCallError] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<CreateTelephonyConfigRequest>({
    region: 'MH', // Default to Maharashtra/Mumbai
  });

  useEffect(() => {
    loadTelephonyConfig();
  }, [agentId]);

  const loadTelephonyConfig = async () => {
    setLoading(true);
    try {
      const config = await api.getTelephonyConfig(userId, agentId);
      setTelephonyConfig(config);
    } catch (e) {
      console.error('Failed to load telephony config:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const config = await api.setupTelephony(userId, agentId, formData);
      setTelephonyConfig(config);
      setShowForm(false);
      setFormData({ region: 'MH' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to setup telephony');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove telephony for this agent?')) return;

    setSaving(true);
    setError(null);

    try {
      await api.deleteTelephony(userId, agentId);
      setTelephonyConfig(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete telephony');
    } finally {
      setSaving(false);
    }
  };

  const handleCallMe = async () => {
    if (!callMeNumber.trim()) {
      setCallError('Please enter a phone number');
      return;
    }

    // Basic phone number validation
    const phoneRegex = /^\+?[1-9]\d{9,14}$/;
    const cleanNumber = callMeNumber.replace(/[\s\-\(\)]/g, '');
    if (!phoneRegex.test(cleanNumber)) {
      setCallError('Please enter a valid phone number (E.164 format, e.g., +14155551234)');
      return;
    }

    setCalling(true);
    setCallStatus('calling');
    setCallError(null);

    try {
      await api.placeOutboundCall(userId, agentId, cleanNumber);
      setCallStatus('connected');
      // Reset after a few seconds
      setTimeout(() => {
        setCallStatus('idle');
        setCallMeNumber('');
      }, 5000);
    } catch (e) {
      setCallStatus('error');
      setCallError(e instanceof Error ? e.message : 'Failed to place call');
    } finally {
      setCalling(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="loading">
          <div className="spinner" />
          <p>Loading telephony settings...</p>
        </div>
      </div>
    );
  }

  // If telephony is configured, show status
  if (telephonyConfig) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>Telephony</h3>
          <span style={{
            padding: '0.25rem 0.75rem',
            borderRadius: '1rem',
            fontSize: '0.875rem',
            background: telephonyConfig.isActive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            color: telephonyConfig.isActive ? '#22c55e' : '#ef4444',
          }}>
            {telephonyConfig.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.375rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Phone Number</span>
            <span style={{ fontWeight: 500 }}>{telephonyConfig.phoneNumber}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.375rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Inbound Calls</span>
            <span style={{ color: telephonyConfig.hasInbound ? '#22c55e' : '#ef4444' }}>
              {telephonyConfig.hasInbound ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.375rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Outbound Calls</span>
            <span style={{ color: telephonyConfig.hasOutbound ? '#22c55e' : '#ef4444' }}>
              {telephonyConfig.hasOutbound ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Call <strong>{telephonyConfig.phoneNumber}</strong> to talk with "{agentName}"
        </p>

        {/* Call Me Section */}
        {telephonyConfig.hasOutbound && (
          <div style={{
            padding: '1rem',
            background: 'var(--bg-tertiary)',
            borderRadius: '0.5rem',
            marginBottom: '1rem'
          }}>
            <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem' }}>Have the agent call you</h4>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="tel"
                className="form-input"
                value={callMeNumber}
                onChange={(e) => {
                  setCallMeNumber(e.target.value);
                  setCallError(null);
                }}
                placeholder="+14155551234"
                disabled={calling || callStatus === 'connected'}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleCallMe}
                disabled={calling || callStatus === 'connected' || !callMeNumber.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {calling ? 'Calling...' : callStatus === 'connected' ? 'Connected!' : 'Call Me'}
              </button>
            </div>
            {callStatus === 'connected' && (
              <p style={{ color: '#22c55e', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
                Call initiated! Answer your phone to talk with "{agentName}"
              </p>
            )}
            {callError && (
              <p style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: 0 }}>
                {callError}
              </p>
            )}
            <small style={{ color: 'var(--text-secondary)', display: 'block', marginTop: '0.5rem' }}>
              Enter your phone number in E.164 format (e.g., +14155551234)
            </small>
          </div>
        )}

        {error && (
          <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>
        )}

        <button
          className="btn btn-secondary"
          onClick={handleDelete}
          disabled={saving}
          style={{ width: '100%' }}
        >
          {saving ? 'Removing...' : 'Remove Telephony'}
        </button>
      </div>
    );
  }

  // Show setup form or button
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginBottom: '1rem' }}>Telephony</h3>

      {!showForm ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Get an Indian virtual number (+91) to enable phone calls with your agent. Supports both inbound and outbound calling.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
          >
            Get Phone Number
          </button>
        </div>
      ) : (
        <form onSubmit={handleSetup}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
            Get an Indian virtual number (Exophone) for your agent. The number will be provisioned automatically via Exotel.
          </p>

          <div className="form-group">
            <label className="form-label">Region</label>
            <select
              className="form-input"
              value={formData.region || 'MH'}
              onChange={(e) => setFormData({ ...formData, region: e.target.value })}
              required
            >
              <option value="MH">Maharashtra / Mumbai</option>
              <option value="DL">Delhi</option>
              <option value="KA">Karnataka / Bangalore</option>
              <option value="TN">Tamil Nadu / Chennai</option>
              <option value="WB">West Bengal / Kolkata</option>
              <option value="GJ">Gujarat / Ahmedabad</option>
              <option value="RJ">Rajasthan / Jaipur</option>
              <option value="UP">Uttar Pradesh / Lucknow</option>
            </select>
            <small style={{ color: 'var(--text-secondary)' }}>
              Select the Indian telecom circle for your virtual number
            </small>
          </div>

          <div style={{
            padding: '0.75rem',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            borderRadius: '0.375rem',
            marginBottom: '1rem'
          }}>
            <p style={{ fontSize: '0.875rem', margin: 0, color: 'var(--text-primary)' }}>
              <strong>What happens next:</strong>
            </p>
            <ul style={{ fontSize: '0.875rem', margin: '0.5rem 0 0 1.25rem', paddingLeft: 0 }}>
              <li>A virtual number will be purchased from Exotel</li>
              <li>Both inbound and outbound calling will be enabled</li>
              <li>Number will be active within 24-48 hours</li>
            </ul>
          </div>

          {error && (
            <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowForm(false)}
              style={{ flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ flex: 1 }}
            >
              {saving ? 'Provisioning...' : 'Get Phone Number'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

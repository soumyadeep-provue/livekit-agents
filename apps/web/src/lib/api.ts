import type { AgentConfig, CreateAgentConfigRequest, CreateTelephonyConfigRequest, OAuthConnectionStatus, ShareInfoResponse, TelephonyStatusResponse, TokenResponse, UpdateAgentConfigRequest, User } from '@studio/shared';

const API_BASE = '/api';

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  userId?: string
): Promise<T> {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (userId) {
    (headers as Record<string, string>)['x-user-id'] = userId;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  // Users
  async getOrCreateUser(email: string, name: string): Promise<User> {
    return fetchApi<User>('/users', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
  },

  // Agents
  async listAgents(userId: string): Promise<AgentConfig[]> {
    return fetchApi<AgentConfig[]>('/agents', {}, userId);
  },

  async getAgent(userId: string, agentId: string): Promise<AgentConfig> {
    return fetchApi<AgentConfig>(`/agents/${agentId}`, {}, userId);
  },

  async createAgent(userId: string, data: CreateAgentConfigRequest): Promise<AgentConfig> {
    return fetchApi<AgentConfig>(
      '/agents',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      userId
    );
  },

  async updateAgent(
    userId: string,
    agentId: string,
    data: UpdateAgentConfigRequest
  ): Promise<AgentConfig> {
    return fetchApi<AgentConfig>(
      `/agents/${agentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
      userId
    );
  },

  async deleteAgent(userId: string, agentId: string): Promise<void> {
    return fetchApi<void>(
      `/agents/${agentId}`,
      {
        method: 'DELETE',
      },
      userId
    );
  },

  // Token
  async getToken(userId: string, agentConfigId: string, participantName?: string): Promise<TokenResponse> {
    return fetchApi<TokenResponse>(
      '/token',
      {
        method: 'POST',
        body: JSON.stringify({ agentConfigId, participantName }),
      },
      userId
    );
  },

  // Public Sharing
  async getShareInfo(shareCode: string): Promise<ShareInfoResponse> {
    return fetchApi<ShareInfoResponse>(`/share/${shareCode}`);
  },

  async getPublicToken(shareCode: string, participantName?: string): Promise<TokenResponse> {
    return fetchApi<TokenResponse>(`/share/${shareCode}/token`, {
      method: 'POST',
      body: JSON.stringify({ shareCode, participantName }),
    });
  },

  // Telephony
  async getTelephonyConfig(userId: string, agentId: string): Promise<TelephonyStatusResponse | null> {
    try {
      return await fetchApi<TelephonyStatusResponse>(`/agents/${agentId}/telephony`, {}, userId);
    } catch {
      return null;
    }
  },

  async getOwnedNumbers(userId: string): Promise<{
    numbers: Array<{
      sid: string;
      phoneNumber: string;
      friendlyName: string;
      capabilities: { Voice: boolean; SMS: boolean };
      dateCreated: string;
    }>;
  }> {
    return fetchApi('/telephony/owned-numbers', {}, userId);
  },

  async setupTelephony(
    userId: string,
    agentId: string,
    data: CreateTelephonyConfigRequest
  ): Promise<TelephonyStatusResponse> {
    return fetchApi<TelephonyStatusResponse>(
      `/agents/${agentId}/telephony`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      userId
    );
  },

  async activateTelephony(userId: string, agentId: string): Promise<{ message: string; status: string; phoneNumber: string; isActive: boolean }> {
    return fetchApi(
      `/agents/${agentId}/telephony/activate`,
      {
        method: 'PATCH',
      },
      userId
    );
  },

  async deleteTelephony(userId: string, agentId: string): Promise<void> {
    return fetchApi<void>(
      `/agents/${agentId}/telephony`,
      {
        method: 'DELETE',
      },
      userId
    );
  },

  async placeOutboundCall(
    userId: string,
    agentConfigId: string,
    toPhoneNumber: string
  ): Promise<{ roomName: string; callSid: string; status: string }> {
    return fetchApi(
      '/call',
      {
        method: 'POST',
        body: JSON.stringify({ agentConfigId, toPhoneNumber }),
      },
      userId
    );
  },

  // OAuth
  async getOAuthConnections(userId: string): Promise<OAuthConnectionStatus[]> {
    return fetchApi<OAuthConnectionStatus[]>('/oauth/connections', {}, userId);
  },

  async startGoogleOAuth(userId: string): Promise<{ authUrl: string }> {
    return fetchApi<{ authUrl: string }>('/oauth/google', {}, userId);
  },

  async disconnectOAuth(userId: string, provider: string): Promise<void> {
    return fetchApi<void>(
      `/oauth/${provider}`,
      {
        method: 'DELETE',
      },
      userId
    );
  },

  // Tools
  async getTools(userId: string): Promise<Array<{
    id: string;
    name: string;
    description: string;
    status: 'available' | 'needs_auth' | 'needs_api_key';
    connectedEmail?: string;
  }>> {
    return fetchApi('/tools', {}, userId);
  },

  // Knowledge Base
  async getKnowledgeBaseDocuments(userId: string, agentId: string): Promise<{
    documents: Array<{
      id: string;
      documentName: string;
      documentType: string;
      fileSizeBytes: number | null;
      chunkCount: number;
      createdAt: string;
    }>;
  }> {
    return fetchApi(`/agents/${agentId}/knowledge-base/documents`, {}, userId);
  },

  async uploadKnowledgeBaseDocument(
    userId: string,
    agentId: string,
    file: File
  ): Promise<{ success: boolean; documentId: string; message: string }> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    if (userId) {
      (headers as Record<string, string>)['x-user-id'] = userId;
    }

    const response = await fetch(`${API_BASE}/agents/${agentId}/knowledge-base/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }

    return response.json();
  },

  async deleteKnowledgeBaseDocument(
    userId: string,
    agentId: string,
    documentId: string
  ): Promise<void> {
    return fetchApi<void>(
      `/agents/${agentId}/knowledge-base/documents/${documentId}`,
      {
        method: 'DELETE',
      },
      userId
    );
  },
};

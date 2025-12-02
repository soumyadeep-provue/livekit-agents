import type { AgentConfig, CreateAgentConfigRequest, CreateTelephonyConfigRequest, OAuthConnection, OAuthProvider, TelephonyConfig, UpdateAgentConfigRequest, UpdateTelephonyConfigRequest, User } from '@studio/shared';
import { generateShareCode } from '@studio/shared';

import { supabase, type DbAgentConfig, type DbOAuthConnection, type DbTelephonyConfig, type DbUser } from './supabase.js';

// Helper to convert DB row to User type
function dbUserToUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Helper to convert DB row to AgentConfig type
function dbAgentToAgentConfig(row: DbAgentConfig): AgentConfig {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    instructions: row.instructions,
    voice: row.voice,
    greeting: row.greeting ?? undefined,
    model: row.model as AgentConfig['model'],
    sttModel: row.stt_model as AgentConfig['sttModel'],
    ttsModel: row.tts_model as AgentConfig['ttsModel'],
    tools: row.tools,
    isPublic: row.is_public,
    shareCode: row.share_code ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Helper to convert DB row to TelephonyConfig type
function dbTelephonyToTelephonyConfig(row: DbTelephonyConfig): TelephonyConfig {
  return {
    id: row.id,
    agentConfigId: row.agent_config_id,
    phoneNumber: row.phone_number,
    exophoneSid: row.exophone_sid,
    inboundTrunkId: row.inbound_trunk_id,
    outboundTrunkId: row.outbound_trunk_id,
    sipDomain: row.sip_domain,
    dispatchRuleId: row.dispatch_rule_id ?? undefined,
    isActive: row.is_active,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Helper to convert DB row to OAuthConnection type
function dbOAuthToOAuthConnection(row: DbOAuthConnection): OAuthConnection {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as OAuthProvider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    scope: row.scope ?? undefined,
    email: row.email ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export const db = {
  // Users
  async createUser(email: string, name: string): Promise<User> {
    const { data, error } = await supabase
      .from('users')
      .insert({ email, name })
      .select()
      .single();

    if (error) throw new Error(`Failed to create user: ${error.message}`);
    return dbUserToUser(data);
  },

  async getUser(id: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select()
      .eq('id', id)
      .single();

    if (error) return null;
    return dbUserToUser(data);
  },

  async getUserByEmail(email: string): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select()
      .eq('email', email)
      .single();

    if (error) return null;
    return dbUserToUser(data);
  },

  // Agent Configs
  async createAgentConfig(userId: string, data: CreateAgentConfigRequest): Promise<AgentConfig> {
    const shareCode = data.isPublic ? generateShareCode() : null;

    const { data: row, error } = await supabase
      .from('agent_configs')
      .insert({
        user_id: userId,
        name: data.name,
        instructions: data.instructions,
        voice: data.voice ?? 'cgSgspJ2msm6clMCkdW9',
        greeting: data.greeting ?? null,
        model: data.model ?? 'gpt-4.1-mini',
        stt_model: data.sttModel ?? 'deepgram/nova-3',
        tts_model: data.ttsModel ?? 'elevenlabs/eleven_turbo_v2_5',
        tools: data.tools ?? [],
        is_public: data.isPublic ?? false,
        share_code: shareCode,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create agent config: ${error.message}`);
    return dbAgentToAgentConfig(row);
  },

  async getAgentConfig(id: string): Promise<AgentConfig | null> {
    const { data, error } = await supabase
      .from('agent_configs')
      .select()
      .eq('id', id)
      .single();

    if (error) return null;
    return dbAgentToAgentConfig(data);
  },

  async getAgentConfigByShareCode(shareCode: string): Promise<AgentConfig | null> {
    const { data, error } = await supabase
      .from('agent_configs')
      .select()
      .eq('share_code', shareCode)
      .eq('is_public', true)
      .single();

    if (error) return null;
    return dbAgentToAgentConfig(data);
  },

  async getAgentConfigsByUser(userId: string): Promise<AgentConfig[]> {
    const { data, error } = await supabase
      .from('agent_configs')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) return [];
    return data.map(dbAgentToAgentConfig);
  },

  async updateAgentConfig(id: string, data: UpdateAgentConfigRequest): Promise<AgentConfig | null> {
    // First get existing to check share code logic
    const existing = await this.getAgentConfig(id);
    if (!existing) return null;

    // Generate share code if becoming public and doesn't have one
    let shareCode = existing.shareCode ?? null;
    if (data.isPublic === true && !existing.shareCode) {
      shareCode = generateShareCode();
    } else if (data.isPublic === false) {
      shareCode = null;
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.instructions !== undefined) updateData.instructions = data.instructions;
    if (data.voice !== undefined) updateData.voice = data.voice;
    if (data.greeting !== undefined) updateData.greeting = data.greeting;
    if (data.model !== undefined) updateData.model = data.model;
    if (data.sttModel !== undefined) updateData.stt_model = data.sttModel;
    if (data.ttsModel !== undefined) updateData.tts_model = data.ttsModel;
    if (data.tools !== undefined) updateData.tools = data.tools;
    if (data.isPublic !== undefined) updateData.is_public = data.isPublic;
    updateData.share_code = shareCode;

    const { data: row, error } = await supabase
      .from('agent_configs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return null;
    return dbAgentToAgentConfig(row);
  },

  async deleteAgentConfig(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('agent_configs')
      .delete()
      .eq('id', id);

    return !error;
  },

  // Telephony Configs
  async createTelephonyConfig(
    agentConfigId: string,
    data: {
      phoneNumber: string;
      exophoneSid: string;
      inboundTrunkId: string;
      outboundTrunkId: string;
      sipDomain: string;
      dispatchRuleId?: string;
    }
  ): Promise<TelephonyConfig> {
    const { data: row, error } = await supabase
      .from('telephony_configs')
      .insert({
        agent_config_id: agentConfigId,
        phone_number: data.phoneNumber,
        exophone_sid: data.exophoneSid,
        inbound_trunk_id: data.inboundTrunkId,
        outbound_trunk_id: data.outboundTrunkId,
        sip_domain: data.sipDomain,
        dispatch_rule_id: data.dispatchRuleId || null,
        is_active: false,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create telephony config: ${error.message}`);
    return dbTelephonyToTelephonyConfig(row);
  },

  async getTelephonyConfig(id: string): Promise<TelephonyConfig | null> {
    const { data, error } = await supabase
      .from('telephony_configs')
      .select()
      .eq('id', id)
      .single();

    if (error) return null;
    return dbTelephonyToTelephonyConfig(data);
  },

  async getTelephonyConfigByAgentId(agentConfigId: string): Promise<TelephonyConfig | null> {
    const { data, error } = await supabase
      .from('telephony_configs')
      .select()
      .eq('agent_config_id', agentConfigId)
      .single();

    if (error) return null;
    return dbTelephonyToTelephonyConfig(data);
  },

  async getTelephonyConfigByPhoneNumber(phoneNumber: string): Promise<TelephonyConfig | null> {
    const { data, error } = await supabase
      .from('telephony_configs')
      .select()
      .eq('phone_number', phoneNumber)
      .eq('is_active', true)
      .single();

    if (error) return null;
    return dbTelephonyToTelephonyConfig(data);
  },

  async updateTelephonyConfig(id: string, data: Partial<TelephonyConfig>): Promise<TelephonyConfig | null> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.dispatchRuleId !== undefined) updateData.dispatch_rule_id = data.dispatchRuleId;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;
    if (data.inboundTrunkId !== undefined) updateData.inbound_trunk_id = data.inboundTrunkId;
    if (data.outboundTrunkId !== undefined) updateData.outbound_trunk_id = data.outboundTrunkId;
    if (data.sipDomain !== undefined) updateData.sip_domain = data.sipDomain;

    const { data: row, error } = await supabase
      .from('telephony_configs')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) return null;
    return dbTelephonyToTelephonyConfig(row);
  },

  async deleteTelephonyConfig(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('telephony_configs')
      .delete()
      .eq('id', id);

    return !error;
  },

  // OAuth Connections
  async createOAuthConnection(
    userId: string,
    provider: OAuthProvider,
    data: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
      scope?: string;
      email?: string;
    }
  ): Promise<OAuthConnection> {
    const { data: row, error } = await supabase
      .from('oauth_connections')
      .insert({
        user_id: userId,
        provider,
        access_token: data.accessToken,
        refresh_token: data.refreshToken ?? null,
        expires_at: data.expiresAt?.toISOString() ?? null,
        scope: data.scope ?? null,
        email: data.email ?? null,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create OAuth connection: ${error.message}`);
    return dbOAuthToOAuthConnection(row);
  },

  async getOAuthConnection(userId: string, provider: OAuthProvider): Promise<OAuthConnection | null> {
    const { data, error } = await supabase
      .from('oauth_connections')
      .select()
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (error) return null;
    return dbOAuthToOAuthConnection(data);
  },

  async getOAuthConnectionsByUser(userId: string): Promise<OAuthConnection[]> {
    const { data, error } = await supabase
      .from('oauth_connections')
      .select()
      .eq('user_id', userId);

    if (error) return [];
    return data.map(dbOAuthToOAuthConnection);
  },

  async updateOAuthConnection(
    userId: string,
    provider: OAuthProvider,
    data: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: Date;
      scope?: string;
      email?: string;
    }
  ): Promise<OAuthConnection | null> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.accessToken !== undefined) updateData.access_token = data.accessToken;
    if (data.refreshToken !== undefined) updateData.refresh_token = data.refreshToken;
    if (data.expiresAt !== undefined) updateData.expires_at = data.expiresAt.toISOString();
    if (data.scope !== undefined) updateData.scope = data.scope;
    if (data.email !== undefined) updateData.email = data.email;

    const { data: row, error } = await supabase
      .from('oauth_connections')
      .update(updateData)
      .eq('user_id', userId)
      .eq('provider', provider)
      .select()
      .single();

    if (error) return null;
    return dbOAuthToOAuthConnection(row);
  },

  async upsertOAuthConnection(
    userId: string,
    provider: OAuthProvider,
    data: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
      scope?: string;
      email?: string;
    }
  ): Promise<OAuthConnection> {
    const { data: row, error } = await supabase
      .from('oauth_connections')
      .upsert({
        user_id: userId,
        provider,
        access_token: data.accessToken,
        refresh_token: data.refreshToken ?? null,
        expires_at: data.expiresAt?.toISOString() ?? null,
        scope: data.scope ?? null,
        email: data.email ?? null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,provider',
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to upsert OAuth connection: ${error.message}`);
    return dbOAuthToOAuthConnection(row);
  },

  async deleteOAuthConnection(userId: string, provider: OAuthProvider): Promise<boolean> {
    const { error} = await supabase
      .from('oauth_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    return !error;
  },

  // Platform Configs
  async getPlatformConfig(key: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('platform_configs')
      .select('value')
      .eq('key', key)
      .single();

    if (error) return null;
    return data.value;
  },

  async setPlatformConfig(key: string, value: string, description?: string): Promise<void> {
    const { error } = await supabase
      .from('platform_configs')
      .upsert({
        key,
        value,
        description: description || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'key',
      });

    if (error) throw new Error(`Failed to set platform config: ${error.message}`);
  },

  async getAllPlatformConfigs(): Promise<Record<string, string>> {
    const { data, error } = await supabase
      .from('platform_configs')
      .select('key, value');

    if (error) throw new Error(`Failed to get platform configs: ${error.message}`);

    const configs: Record<string, string> = {};
    for (const row of data) {
      configs[row.key] = row.value;
    }
    return configs;
  },
};

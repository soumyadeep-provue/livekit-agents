import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database types
export interface DbUser {
  id: string;
  email: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface DbAgentConfig {
  id: string;
  user_id: string;
  name: string;
  instructions: string;
  voice: string;
  greeting: string | null;
  model: string;
  stt_model: string;
  tts_model: string;
  tools: string[];
  is_public: boolean;
  share_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbTelephonyConfig {
  id: string;
  agent_config_id: string;
  phone_number: string;
  exophone_sid: string;
  inbound_trunk_id: string;
  sip_domain: string;
  dispatch_rule_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbPlatformConfig {
  id: string;
  key: string;
  value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbOAuthConnection {
  id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

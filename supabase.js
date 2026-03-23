const { createClient } = require('@supabase/supabase-js');

let adminClient = null;

function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

function getRealtimePublicConfig() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  return {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  };
}

module.exports = {
  getSupabaseAdmin,
  getRealtimePublicConfig,
};

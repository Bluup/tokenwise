// Bundled public config for the shared Bluu Supabase project. The anon key is a
// PUBLISHABLE key (RLS-protected, same one shipped in other Bluu app bundles) —
// safe to ship in this open-source CLI. Override either via env if self-hosting.
export const SUPABASE_URL =
  process.env.TOKENWISE_SUPABASE_URL ?? 'https://keirhrqfzoxsyawjhzen.supabase.co';
export const SUPABASE_ANON_KEY =
  process.env.TOKENWISE_SUPABASE_ANON_KEY ?? 'sb_publishable_nrJDq0_MfFdZDRZfgXHYQA_4Bs7U3GI';

/** PostgREST endpoints we use. */
export const SUBMISSIONS_URL = `${SUPABASE_URL}/rest/v1/tw_submissions`;
export const LEADERBOARD_URL = `${SUPABASE_URL}/rest/v1/tw_leaderboard`;

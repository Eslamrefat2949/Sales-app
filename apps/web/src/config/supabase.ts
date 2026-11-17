/**
 * Supabase project RAVIN SALES APP. The publishable key is designed to be public (it ships inside every
 * browser build); what each user can do is enforced by row level security and the database functions.
 * Builds can point elsewhere with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? 'https://ymznomzyyenbgzsjddcl.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_1zWnfGX2S7yDzzNjgohJiA_XvGVbkO7';

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config/supabase.ts';

export const AUTH_STORAGE_KEY = 'ravin-sales:auth';

/** One client for the whole app. The session is kept on the phone so it keeps working offline. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
});

/** Error codes our database functions raise in the message (e.g. VOID_ALREADY_EXPORTED). */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    if (/fetch|network|Failed to fetch|Load failed/i.test(message)) return 'OFFLINE';
    return message.split(/\s/)[0] ?? 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/** Throws the Supabase error so callers can use try/catch with one error path. */
export function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

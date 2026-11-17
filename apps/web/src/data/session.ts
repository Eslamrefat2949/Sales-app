import { supabase, unwrap } from '../lib/supabase.ts';

export interface DirectoryEntry {
  readonly accountId: string;
  readonly kind: 'admin' | 'branch';
  readonly label: string;
  readonly branchCode: string | null;
}

export async function loadDirectory(): Promise<DirectoryEntry[]> {
  const rows = unwrap(await supabase.rpc('login_directory')) as {
    account_id: string;
    kind: 'admin' | 'branch';
    label: string;
    branch_code: string | null;
  }[];
  return rows.map((row) => ({
    accountId: row.account_id,
    kind: row.kind,
    label: row.label,
    branchCode: row.branch_code,
  }));
}

export type SignInResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'WRONG_PIN'; readonly attemptsLeft: number }
  | { readonly ok: false; readonly reason: 'LOCKED' | 'UNKNOWN_ACCOUNT' | 'OFFLINE' | 'FAILED' };

/**
 * Checks the PIN on the server (which locks the account after 5 wrong PINs), then signs in with the
 * hidden email the server returns only for the right PIN.
 */
export async function signInWithPin(accountId: string, pin: string): Promise<SignInResult> {
  let check: { ok: boolean; reason?: string; attempts_left?: number; email?: string };
  try {
    check = unwrap(await supabase.rpc('verify_pin', { p_account_id: accountId, p_pin: pin })) as typeof check;
  } catch {
    return { ok: false, reason: navigator.onLine ? 'FAILED' : 'OFFLINE' };
  }
  if (!check.ok || !check.email) {
    if (check.reason === 'WRONG_PIN') return { ok: false, reason: 'WRONG_PIN', attemptsLeft: check.attempts_left ?? 0 };
    return { ok: false, reason: check.reason === 'LOCKED' ? 'LOCKED' : 'UNKNOWN_ACCOUNT' };
  }
  const { error } = await supabase.auth.signInWithPassword({ email: check.email, password: pin });
  return error ? { ok: false, reason: 'FAILED' } : { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: 'local' });
}

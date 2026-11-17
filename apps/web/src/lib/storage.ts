/**
 * Per-device persistence. Storage can be unavailable (private mode, blocked site data), so every
 * access is guarded and the app keeps working in memory.
 * Demo only: the production app keeps invoices in IndexedDB and syncs them to Supabase.
 */
const PREFIX = 'ravin-sales:v2:';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage unavailable: keep running in memory.
  }
}

/** Short haptic tick when a piece is added. Ignored where vibration is unsupported or blocked. */
export function tick(): void {
  try {
    navigator.vibrate?.(15);
  } catch {
    // Not supported.
  }
}

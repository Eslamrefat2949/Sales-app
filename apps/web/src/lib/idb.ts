import { del, get, set } from 'idb-keyval';

/**
 * IndexedDB for the large or important things kept on the phone: the catalog and invoices waiting to
 * be sent. Failures are swallowed so the app keeps working in memory (private mode, full storage).
 */
export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(`ravin-sales:${key}`);
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  try {
    await set(`ravin-sales:${key}`, value);
    return true;
  } catch {
    return false;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await del(`ravin-sales:${key}`);
  } catch {
    // Nothing to clean up.
  }
}

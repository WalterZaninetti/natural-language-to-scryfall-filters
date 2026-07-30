import { Firestore } from '@google-cloud/firestore';

let client: Firestore | undefined;
let disabledReason: string | undefined;

/**
 * Persistence is optional on purpose: without credentials the service still translates, it just
 * re-pays for model calls it would otherwise have cached. Making Firestore mandatory would turn
 * a missing local service-account file into a hard startup failure for no functional gain.
 */
export function getStore(): Firestore | undefined {
  if (client) return client;
  if (disabledReason) return undefined;

  try {
    client = new Firestore({ ignoreUndefinedProperties: true });
    return client;
  } catch (error) {
    disabledReason = error instanceof Error ? error.message : String(error);
    console.warn(`[store] Firestore unavailable, running without persistence: ${disabledReason}`);
    return undefined;
  }
}

export function storeStatus(): { enabled: boolean; reason?: string } {
  const enabled = getStore() !== undefined && disabledReason === undefined;
  return disabledReason ? { enabled, reason: disabledReason } : { enabled };
}

function markUnavailable(operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!disabledReason) {
    disabledReason = message;
    console.warn(`[store] disabling persistence after ${operation} failed: ${message}`);
  }
}

export async function readDoc<T>(collection: string, id: string): Promise<T | undefined> {
  const db = getStore();
  if (!db) return undefined;
  try {
    const snap = await db.collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : undefined;
  } catch (error) {
    markUnavailable(`read ${collection}/${id}`, error);
    return undefined;
  }
}

export async function writeDoc(collection: string, id: string, data: unknown): Promise<void> {
  const db = getStore();
  if (!db) return;
  try {
    await db.collection(collection).doc(id).set(data as Record<string, unknown>);
  } catch (error) {
    markUnavailable(`write ${collection}/${id}`, error);
  }
}

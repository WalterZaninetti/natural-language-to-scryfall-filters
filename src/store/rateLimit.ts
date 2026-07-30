import { FieldValue } from '@google-cloud/firestore';
import { getStore } from './firestore.ts';

const COLLECTION = 'rateLimits';

interface Bucket {
  count: number;
  resetAt: number;
}

const memory = new Map<string, Bucket>();

function windowKey(identifier: string): { key: string; resetAt: number } {
  const hour = Math.floor(Date.now() / 3_600_000);
  return { key: `${identifier}:${String(hour)}`, resetAt: (hour + 1) * 3_600_000 };
}

function checkMemory(key: string, resetAt: number, limit: number): boolean {
  const existing = memory.get(key);
  if (!existing || existing.resetAt <= Date.now()) {
    memory.set(key, { count: 1, resetAt });
    if (memory.size > 10_000) {
      for (const [k, bucket] of memory) if (bucket.resetAt <= Date.now()) memory.delete(k);
    }
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

export async function allowRequest(identifier: string, limit: number): Promise<boolean> {
  const { key, resetAt } = windowKey(identifier);
  const db = getStore();
  if (!db) return checkMemory(key, resetAt, limit);

  try {
    const ref = db.collection(COLLECTION).doc(key);
    const after = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = ((snap.data()?.count as number | undefined) ?? 0) + 1;
      tx.set(ref, { count: FieldValue.increment(1), resetAt }, { merge: true });
      return count;
    });
    return after <= limit;
  } catch {
    return checkMemory(key, resetAt, limit);
  }
}

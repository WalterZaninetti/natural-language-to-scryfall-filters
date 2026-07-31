import { FieldValue } from '@google-cloud/firestore';
import { getStore } from './firestore.ts';

const COLLECTION = 'dailyBudget';

interface Day {
  calls: number;
  resetAt: number;
}

let memory: Day | undefined;

function today(): { key: string; resetAt: number } {
  const day = Math.floor(Date.now() / 86_400_000);
  return {
    key: new Date(day * 86_400_000).toISOString().slice(0, 10),
    resetAt: (day + 1) * 86_400_000,
  };
}

function memoryDay(resetAt: number): Day {
  if (!memory || memory.resetAt <= Date.now()) memory = { calls: 0, resetAt };
  return memory;
}

/**
 * A ceiling on model calls per UTC day, across every caller.
 *
 * The per-IP hourly limit does not bound spend: rotating IPs is cheap and costs an attacker
 * nothing, so it only shapes ordinary traffic. This is the number that actually caps the bill.
 *
 * Checked before the work and recorded after it, so concurrent requests can overshoot the limit
 * by roughly the number in flight. That is the right trade for a spend guard — holding a
 * transaction open across a model call would serialise the whole service to protect a bound that
 * is already approximate.
 */
export async function withinDailyBudget(limit: number): Promise<boolean> {
  const { key, resetAt } = today();
  const db = getStore();
  if (!db) return memoryDay(resetAt).calls < limit;

  try {
    const snap = await db.collection(COLLECTION).doc(key).get();
    return ((snap.data()?.calls as number | undefined) ?? 0) < limit;
  } catch {
    return memoryDay(resetAt).calls < limit;
  }
}

/** Cache hits pass 0 — only calls that actually reached the model are charged. */
export async function recordModelCalls(count: number): Promise<void> {
  if (count <= 0) return;
  const { key, resetAt } = today();
  const db = getStore();

  if (!db) {
    memoryDay(resetAt).calls += count;
    return;
  }

  try {
    await db
      .collection(COLLECTION)
      .doc(key)
      .set({ calls: FieldValue.increment(count), resetAt: new Date(resetAt) }, { merge: true });
  } catch {
    memoryDay(resetAt).calls += count;
  }
}

export async function dailyBudgetStatus(limit: number): Promise<{ used: number; limit: number }> {
  const { key, resetAt } = today();
  const db = getStore();
  if (!db) return { used: memoryDay(resetAt).calls, limit };

  try {
    const snap = await db.collection(COLLECTION).doc(key).get();
    return { used: (snap.data()?.calls as number | undefined) ?? 0, limit };
  } catch {
    return { used: memoryDay(resetAt).calls, limit };
  }
}

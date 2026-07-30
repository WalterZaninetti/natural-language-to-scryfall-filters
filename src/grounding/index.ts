import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readDoc, writeDoc } from '../store/firestore.ts';
import { fetchGroundingIndex } from './refresh.ts';
import { INDEX_VERSION, type GroundingIndex } from './types.ts';

const COLLECTION = 'meta';
const DOC_ID = 'groundingIndex';

let cached: GroundingIndex | undefined;
let loadedFrom: 'firestore' | 'snapshot' | undefined;

function loadSnapshot(): GroundingIndex {
  const file = path.join(import.meta.dirname, 'snapshot.json');
  return JSON.parse(readFileSync(file, 'utf-8')) as GroundingIndex;
}

export async function getGroundingIndex(): Promise<GroundingIndex> {
  if (cached) return cached;

  const stored = await readDoc<GroundingIndex>(COLLECTION, DOC_ID);
  if (stored && stored.version === INDEX_VERSION && stored.sets.length > 0) {
    cached = stored;
    loadedFrom = 'firestore';
    return cached;
  }

  cached = loadSnapshot();
  loadedFrom = 'snapshot';
  return cached;
}

export async function refreshGroundingIndex(): Promise<GroundingIndex> {
  const index = await fetchGroundingIndex();
  await writeDoc(COLLECTION, DOC_ID, index);
  cached = index;
  loadedFrom = 'firestore';
  return index;
}

export function groundingStatus(): { source?: string; fetchedAt?: string; sets?: number } {
  if (!cached) return {};
  return { source: loadedFrom, fetchedAt: cached.fetchedAt, sets: cached.sets.length };
}

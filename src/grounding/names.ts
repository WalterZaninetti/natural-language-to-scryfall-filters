import { findEnglishName, resolveLocalizedName } from '../scryfall.ts';
import { readDoc, writeDoc } from '../store/firestore.ts';
import { normalizeText } from './match.ts';

const COLLECTION = 'nameResolutions';

export type NameResolution =
  | { status: 'english'; canonical: string }
  | { status: 'resolved'; canonical: string; printedName: string; lang: string }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'unknown' };

interface StoredResolution {
  result: NameResolution;
  resolvedAt: string;
}

const memo = new Map<string, NameResolution>();

/**
 * Card names are a finite, near-static vocabulary, so resolutions are cached without expiry.
 * After a little traffic this is almost always a memory or Firestore hit rather than two
 * Scryfall calls.
 */
export async function resolveCardName(raw: string): Promise<NameResolution> {
  const name = raw.trim();
  if (name.length === 0) return { status: 'unknown' };

  const key = normalizeText(name).replace(/[^a-z0-9]+/g, '-').slice(0, 200);

  const inMemory = memo.get(key);
  if (inMemory) return inMemory;

  const stored = await readDoc<StoredResolution>(COLLECTION, key);
  if (stored?.result) {
    memo.set(key, stored.result);
    return stored.result;
  }

  const result = await lookup(name);
  memo.set(key, result);
  await writeDoc(COLLECTION, key, { result, resolvedAt: new Date().toISOString() } satisfies StoredResolution);
  return result;
}

async function lookup(name: string): Promise<NameResolution> {
  const english = await findEnglishName(name);
  if (english) return { status: 'english', canonical: english };

  const matches = await resolveLocalizedName(name);
  if (matches.length === 1) {
    const only = matches[0]!;
    return { status: 'resolved', canonical: only.name, printedName: only.printedName, lang: only.lang };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', candidates: matches.map((m) => m.name) };
  }
  return { status: 'unknown' };
}

/**
 * Substitutes canonical English names into the query. A localized name left in place produces a
 * filter that finds nothing on scryfall.com, because include_multilingual is a URL parameter and
 * cannot be expressed inside the query string itself.
 */
export function applyResolution(query: string, original: string, canonical: string): string {
  if (original === canonical) return query;
  const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return query.replace(new RegExp(escaped, 'gi'), canonical);
}

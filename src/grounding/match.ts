import type { EntityCandidates, GroundingIndex, SetEntry } from './types.ts';

const LIGATURES: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l' };

/**
 * Shared by the cache key and the entity matcher, so "Rapidità" and "rapidita" are one entry.
 * NFKD plus combining-mark removal handles the accented languages; the ligature map covers the
 * few characters that have no decomposition (German ß above all).
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[ßæœøđł]/g, (ch) => LIGATURES[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim();
}

function words(normalized: string): string[] {
  return normalized.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Every 1..maxLen word run, so multi-word names like "double strike" are reachable. */
function ngrams(tokens: string[], maxLen: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    for (let len = 1; len <= maxLen && i + len <= tokens.length; len += 1) {
      out.add(tokens.slice(i, i + len).join(' '));
    }
  }
  return out;
}

const MAX_SETS = 12;
const MAX_PER_CATALOG = 20;

function matchSets(normalized: string, tokens: Set<string>, index: GroundingIndex): SetEntry[] {
  const scored = new Map<string, { set: SetEntry; score: number }>();

  for (const set of index.sets) {
    if (set.normalized.length < 4) continue;

    let score = 0;
    if (normalized.includes(set.normalized)) {
      score = 100 + set.normalized.length;
    } else {
      // "Kamigawa" should still reach "Kamigawa: Neon Dynasty".
      const distinctive = words(set.normalized).filter((w) => w.length >= 5);
      const hits = distinctive.filter((w) => tokens.has(w)).length;
      if (hits > 0) score = 10 * hits;
    }

    if (score === 0) continue;
    const existing = scored.get(set.code);
    if (!existing || existing.score < score) scored.set(set.code, { set, score });
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score || (b.set.releasedAt ?? '').localeCompare(a.set.releasedAt ?? ''))
    .slice(0, MAX_SETS)
    .map((entry) => entry.set);
}

function matchVocabulary(tokens: Set<string>, vocabulary: readonly string[]): string[] {
  const out: string[] = [];
  for (const term of vocabulary) {
    if (tokens.has(normalizeText(term))) out.push(term);
    if (out.length >= MAX_PER_CATALOG) break;
  }
  return out;
}

/**
 * Only ever a hint for the prompt. Non-English input matches little here beyond set and card
 * names, which is expected — the model handles localized game vocabulary and the linter checks
 * the English value it produces.
 */
export function findCandidates(text: string, index: GroundingIndex): EntityCandidates {
  const normalized = normalizeText(text);
  const tokens = ngrams(words(normalized), 4);

  return {
    sets: matchSets(normalized, tokens, index),
    keywords: matchVocabulary(tokens, index.keywords),
    types: matchVocabulary(tokens, index.types),
    watermarks: matchVocabulary(tokens, index.watermarks),
  };
}

export function renderCandidates(candidates: EntityCandidates): string {
  const lines: string[] = [];
  if (candidates.sets.length > 0) {
    lines.push('sets:');
    for (const set of candidates.sets) {
      const released = set.releasedAt ? ` (${set.releasedAt.slice(0, 4)})` : '';
      const block = set.block ? ` [block: ${set.block}]` : '';
      lines.push(`  ${set.code} = ${set.name}${released}${block}`);
    }
  }
  if (candidates.keywords.length > 0) lines.push(`keywords: ${candidates.keywords.join(', ')}`);
  if (candidates.types.length > 0) lines.push(`types: ${candidates.types.join(', ')}`);
  if (candidates.watermarks.length > 0) lines.push(`watermarks: ${candidates.watermarks.join(', ')}`);
  return lines.join('\n');
}

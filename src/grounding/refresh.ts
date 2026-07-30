import { CARD_TYPES } from '../registry/enums.ts';
import { fetchCatalog, fetchSets } from '../scryfall.ts';
import { normalizeText } from './match.ts';
import { INDEX_VERSION, type GroundingIndex, type SetEntry } from './types.ts';

const SUBTYPE_CATALOGS = ['creature-types', 'land-types', 'artifact-types', 'spell-types', 'supertypes'];

export async function fetchGroundingIndex(): Promise<GroundingIndex> {
  const [rawSets, keywords, watermarks, abilityWords, ...subtypeLists] = await Promise.all([
    fetchSets(),
    fetchCatalog('keyword-abilities'),
    fetchCatalog('watermarks'),
    fetchCatalog('ability-words'),
    ...SUBTYPE_CATALOGS.map((name) => fetchCatalog(name)),
  ]);

  const sets: SetEntry[] = rawSets.map((set) => ({
    code: set.code,
    name: set.name,
    normalized: normalizeText(set.name),
    setType: set.set_type,
    ...(set.released_at ? { releasedAt: set.released_at } : {}),
    ...(set.block_code ? { blockCode: set.block_code } : {}),
    ...(set.block ? { block: set.block } : {}),
  }));

  const types = [...new Set([...CARD_TYPES, ...subtypeLists.flat().map((t) => t.toLowerCase())])].sort();

  return {
    version: INDEX_VERSION,
    fetchedAt: new Date().toISOString(),
    sets: sets.sort((a, b) => a.code.localeCompare(b.code)),
    keywords: [...keywords].sort(),
    types,
    watermarks: [...watermarks].sort(),
    abilityWords: [...abilityWords].sort(),
  };
}

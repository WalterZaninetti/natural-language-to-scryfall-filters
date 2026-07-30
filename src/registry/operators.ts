import {
  COLOR_LETTERS,
  COLOR_NAMES,
  DIRECTION_VALUES,
  FORMATS,
  HAS_VALUES,
  IS_VALUES,
  LANGUAGES,
  ORDER_VALUES,
  RARITIES,
  SET_TYPES,
  UNIQUE_VALUES,
} from './enums.ts';

export const REGISTRY_VERSION = 1;

export type Comparison = ':' | '=' | '!=' | '<' | '>' | '<=' | '>=';

export const EQUALITY: readonly Comparison[] = [':', '=', '!='];
export const NUMERIC: readonly Comparison[] = [':', '=', '!=', '<', '>', '<=', '>='];
export const COLON: readonly Comparison[] = [':'];

export type CatalogName = 'keywords' | 'types' | 'sets' | 'watermarks';

/**
 * `strict` decides what a value mismatch means. Strict domains reject and trigger a repair;
 * non-strict ones only annotate, because the vocabulary is known-incomplete (`is:`) or the
 * value space is open (`in:`, free text). Getting this wrong in the strict direction is the
 * expensive mistake — a false rejection is worse than a term the Scryfall probe would catch.
 */
export type ValueDomain =
  | { kind: 'enum'; values: readonly string[]; strict: boolean }
  | { kind: 'catalog'; catalog: CatalogName; strict: boolean }
  | { kind: 'typeLine' }
  | { kind: 'color' }
  | { kind: 'mana' }
  | { kind: 'integer'; allowStar?: boolean; allowParity?: boolean; allowStatRef?: boolean }
  | { kind: 'decimal' }
  | { kind: 'date' }
  | { kind: 'text' };

export interface OperatorSpec {
  key: string;
  aliases: readonly string[];
  group: string;
  comparisons: readonly Comparison[];
  domain: ValueDomain;
  summary: string;
  example: string;
}

export const OPERATORS: readonly OperatorSpec[] = [
  {
    key: 'color',
    aliases: ['c'],
    group: 'Colour',
    comparisons: NUMERIC,
    domain: { kind: 'color' },
    summary: "Colours in the card's mana cost. Letters combine (wu); guild/shard names work.",
    example: 'c:rg',
  },
  {
    key: 'identity',
    aliases: ['id'],
    group: 'Colour',
    comparisons: NUMERIC,
    domain: { kind: 'color' },
    summary: 'Commander colour identity — includes mana symbols in rules text.',
    example: 'id<=bant',
  },
  {
    key: 'devotion',
    aliases: [],
    group: 'Colour',
    comparisons: NUMERIC,
    domain: { kind: 'mana' },
    summary: 'Devotion to one or two colours, written as mana symbols.',
    example: 'devotion:{u}{u}',
  },
  {
    key: 'produces',
    aliases: [],
    group: 'Colour',
    comparisons: EQUALITY,
    domain: { kind: 'color' },
    summary: 'Colours of mana the card can produce.',
    example: 'produces:rg',
  },
  {
    key: 'type',
    aliases: ['t'],
    group: 'Type',
    comparisons: EQUALITY,
    domain: { kind: 'typeLine' },
    summary: 'Any word in the type line — card types, supertypes, subtypes. Partial words match.',
    example: 't:legendary t:goblin',
  },
  {
    key: 'oracle',
    aliases: ['o'],
    group: 'Text',
    comparisons: EQUALITY,
    domain: { kind: 'text' },
    summary: 'Oracle rules text. Use ~ as a placeholder for the card name.',
    example: 'o:"draw a card"',
  },
  {
    key: 'fulloracle',
    aliases: ['fo'],
    group: 'Text',
    comparisons: EQUALITY,
    domain: { kind: 'text' },
    summary: 'Oracle text including reminder text.',
    example: 'fo:"you may cast"',
  },
  {
    key: 'name',
    aliases: [],
    group: 'Text',
    comparisons: EQUALITY,
    domain: { kind: 'text' },
    summary: 'Card name. Bare words search the name too.',
    example: 'name:/^Lightning/',
  },
  {
    key: 'keyword',
    aliases: ['kw'],
    group: 'Text',
    comparisons: EQUALITY,
    domain: { kind: 'catalog', catalog: 'keywords', strict: true },
    summary: 'A keyword ability. Must be the exact keyword; quote multi-word ones.',
    example: 'kw:flying kw:"double strike"',
  },
  {
    key: 'mana',
    aliases: ['m'],
    group: 'Mana',
    comparisons: NUMERIC,
    domain: { kind: 'mana' },
    summary: 'Mana cost as symbols. {c} generic, {u/p} phyrexian, {2/w} hybrid.',
    example: 'm:{2}{r}{r}',
  },
  {
    key: 'manavalue',
    aliases: ['mv', 'cmc'],
    group: 'Mana',
    comparisons: NUMERIC,
    domain: { kind: 'integer', allowParity: true },
    summary: 'Converted mana cost. Accepts a number, or even/odd.',
    example: 'mv<=3',
  },
  {
    key: 'power',
    aliases: ['pow'],
    group: 'Stats',
    comparisons: NUMERIC,
    domain: { kind: 'integer', allowStar: true, allowStatRef: true },
    summary: 'Creature power. Can be compared to toughness.',
    example: 'pow>=5',
  },
  {
    key: 'toughness',
    aliases: ['tou'],
    group: 'Stats',
    comparisons: NUMERIC,
    domain: { kind: 'integer', allowStar: true, allowStatRef: true },
    summary: 'Creature toughness.',
    example: 'tou<2',
  },
  {
    key: 'loyalty',
    aliases: ['loy'],
    group: 'Stats',
    comparisons: NUMERIC,
    domain: { kind: 'integer', allowStar: true },
    summary: 'Planeswalker starting loyalty.',
    example: 'loy=3',
  },
  {
    key: 'is',
    aliases: [],
    group: 'Predicates',
    comparisons: COLON,
    domain: { kind: 'enum', values: IS_VALUES, strict: false },
    summary: 'Card property shorthand (frames, printings, land cycles, deck roles).',
    example: 'is:commander is:fetchland',
  },
  {
    key: 'not',
    aliases: [],
    group: 'Predicates',
    comparisons: COLON,
    domain: { kind: 'enum', values: IS_VALUES, strict: false },
    summary: 'Negated form of is:.',
    example: 'not:reprint',
  },
  {
    key: 'has',
    aliases: [],
    group: 'Predicates',
    comparisons: COLON,
    domain: { kind: 'enum', values: HAS_VALUES, strict: false },
    summary: 'Presence of a printed feature.',
    example: 'has:watermark',
  },
  {
    key: 'in',
    aliases: [],
    group: 'Predicates',
    comparisons: COLON,
    domain: { kind: 'text' },
    summary: 'Appeared in a given set, game, or language at some point.',
    example: 'in:booster in:mtgo',
  },
  {
    key: 'rarity',
    aliases: ['r'],
    group: 'Rarity',
    comparisons: NUMERIC,
    domain: { kind: 'enum', values: RARITIES, strict: true },
    summary: 'Print rarity. Ordered, so comparisons work.',
    example: 'r>=rare',
  },
  {
    key: 'set',
    aliases: ['s', 'e', 'edition'],
    group: 'Sets',
    comparisons: EQUALITY,
    domain: { kind: 'catalog', catalog: 'sets', strict: true },
    summary: 'Set code. Use the three-or-four letter code, not the set name.',
    example: 'set:neo',
  },
  {
    key: 'block',
    aliases: [],
    group: 'Sets',
    comparisons: EQUALITY,
    domain: { kind: 'catalog', catalog: 'sets', strict: false },
    summary: 'Every set in the block containing the given set code.',
    example: 'block:chk',
  },
  {
    key: 'settype',
    aliases: ['st'],
    group: 'Sets',
    comparisons: EQUALITY,
    domain: { kind: 'enum', values: SET_TYPES, strict: true },
    summary: 'Category of set the printing came from.',
    example: 'st:commander',
  },
  {
    key: 'format',
    aliases: ['f'],
    group: 'Legality',
    comparisons: EQUALITY,
    domain: { kind: 'enum', values: FORMATS, strict: true },
    summary: 'Legal in the given format.',
    example: 'f:modern',
  },
  {
    key: 'banned',
    aliases: [],
    group: 'Legality',
    comparisons: EQUALITY,
    domain: { kind: 'enum', values: FORMATS, strict: true },
    summary: 'Banned in the given format.',
    example: 'banned:legacy',
  },
  {
    key: 'restricted',
    aliases: [],
    group: 'Legality',
    comparisons: EQUALITY,
    domain: { kind: 'enum', values: FORMATS, strict: true },
    summary: 'Restricted in the given format.',
    example: 'restricted:vintage',
  },
  {
    key: 'usd',
    aliases: [],
    group: 'Price',
    comparisons: NUMERIC,
    domain: { kind: 'decimal' },
    summary: 'Price in US dollars on TCGplayer.',
    example: 'usd<5',
  },
  {
    key: 'eur',
    aliases: [],
    group: 'Price',
    comparisons: NUMERIC,
    domain: { kind: 'decimal' },
    summary: 'Price in euros on Cardmarket.',
    example: 'eur<=10',
  },
  {
    key: 'tix',
    aliases: [],
    group: 'Price',
    comparisons: NUMERIC,
    domain: { kind: 'decimal' },
    summary: 'Price in MTGO tickets.',
    example: 'tix<1',
  },
  {
    key: 'artist',
    aliases: ['a'],
    group: 'Credits',
    comparisons: EQUALITY,
    domain: { kind: 'text' },
    summary: 'Illustrator name.',
    example: 'a:"rebecca guay"',
  },
  {
    key: 'flavor',
    aliases: ['ft'],
    group: 'Credits',
    comparisons: EQUALITY,
    domain: { kind: 'text' },
    summary: 'Flavour text.',
    example: 'ft:"the beginning"',
  },
  {
    key: 'watermark',
    aliases: ['wm'],
    group: 'Credits',
    comparisons: EQUALITY,
    domain: { kind: 'catalog', catalog: 'watermarks', strict: true },
    summary: 'Printed watermark.',
    example: 'wm:izzet',
  },
  {
    key: 'year',
    aliases: [],
    group: 'Time',
    comparisons: NUMERIC,
    domain: { kind: 'integer' },
    summary: 'Year of the printing.',
    example: 'year>=2020',
  },
  {
    key: 'date',
    aliases: [],
    group: 'Time',
    comparisons: NUMERIC,
    domain: { kind: 'date' },
    summary: 'Release date, as a year, an ISO date, or a set code.',
    example: 'date>=2021-01-01',
  },
  {
    key: 'language',
    aliases: ['lang'],
    group: 'Language',
    comparisons: EQUALITY,
    domain: { kind: 'enum', values: [...LANGUAGES, 'any'], strict: true },
    summary: 'Language the card was PRINTED in. Not the language of the question.',
    example: 'lang:ja',
  },
  {
    key: 'order',
    aliases: [],
    group: 'Sort',
    comparisons: COLON,
    domain: { kind: 'enum', values: ORDER_VALUES, strict: true },
    summary: 'Sort field for the result list.',
    example: 'order:usd',
  },
  {
    key: 'direction',
    aliases: [],
    group: 'Sort',
    comparisons: COLON,
    domain: { kind: 'enum', values: DIRECTION_VALUES, strict: true },
    summary: 'Sort direction.',
    example: 'direction:asc',
  },
  {
    key: 'unique',
    aliases: [],
    group: 'Sort',
    comparisons: COLON,
    domain: { kind: 'enum', values: UNIQUE_VALUES, strict: true },
    summary: 'How duplicate printings are collapsed.',
    example: 'unique:cards',
  },
];

const BY_NAME = new Map<string, OperatorSpec>();
for (const spec of OPERATORS) {
  BY_NAME.set(spec.key, spec);
  for (const alias of spec.aliases) BY_NAME.set(alias, spec);
}

export function lookupOperator(name: string): OperatorSpec | undefined {
  return BY_NAME.get(name.toLowerCase());
}

export function isKnownOperator(name: string): boolean {
  return BY_NAME.has(name.toLowerCase());
}

export function allOperatorNames(): string[] {
  return [...BY_NAME.keys()].sort();
}

export const COLOR_VOCABULARY: readonly string[] = [...COLOR_LETTERS, ...COLOR_NAMES];

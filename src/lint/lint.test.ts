import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { GroundingIndex } from '../grounding/types.ts';
import { lintQuery } from './lint.ts';
import { tokenize } from './tokenize.ts';

const index = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'grounding', 'snapshot.json'), 'utf-8'),
) as GroundingIndex;

const errors = (query: string) => lintQuery(query, index).issues.filter((i) => i.severity === 'error');

describe('tokenize', () => {
  it('splits filters, bare words and structure', () => {
    const { tokens, confident } = tokenize('c:r -t:goblin (mv<=3 or kw:"double strike")');
    assert.equal(confident, true);
    assert.deepEqual(
      tokens.map((t) => t.type),
      ['filter', 'filter', 'group-open', 'filter', 'or', 'filter', 'group-close'],
    );
    const negated = tokens[1];
    assert.equal(negated.type === 'filter' && negated.negated, true);
    const quoted = tokens[5];
    assert.equal(quoted.type === 'filter' && quoted.value, 'double strike');
  });

  it('keeps regex terms intact, including spaces and slashes', () => {
    const { tokens, confident } = tokenize('o:/draw a card/ name:/^Lightning/');
    assert.equal(confident, true);
    const first = tokens[0];
    assert.equal(first.type === 'filter' && first.regex, true);
    assert.equal(first.type === 'filter' && first.value, 'draw a card');
  });

  it('reports low confidence on unbalanced input instead of guessing', () => {
    assert.equal(tokenize('c:r (t:goblin').confident, false);
    assert.equal(tokenize('o:"unterminated').confident, false);
    assert.equal(tokenize('c:r )').confident, false);
  });
});

describe('lint: rejects what Scryfall would silently swallow', () => {
  it('rejects an unknown filter key and suggests a near miss', () => {
    const [issue] = errors('t:creature stamp:foil');
    assert.ok(issue, 'expected an error for stamp:');
    assert.match(issue.message, /not an available filter/);
  });

  it('rejects a non-numeric mana value', () => {
    assert.equal(errors('t:creature cmc:banana').length, 1);
  });

  it('rejects an unknown keyword', () => {
    assert.equal(errors('kw:frobnicate').length, 1);
  });

  it('rejects an untranslated type, which Scryfall answers with an empty result rather than a warning', () => {
    assert.equal(errors('t:cavaliere').length, 1);
    assert.equal(errors('t:zauberspruch').length, 1);
  });

  it('rejects an invalid set code, which Scryfall never warns about', () => {
    assert.equal(errors('set:notarealset').length, 1);
    assert.equal(errors('set:neo').length, 0);
  });

  it('rejects invalid closed enums', () => {
    assert.equal(errors('f:notaformat').length, 1);
    assert.equal(errors('r:legendary').length, 1);
    assert.equal(errors('lang:klingon').length, 1);
    assert.equal(errors('order:price').length, 1);
  });
});

describe('lint: accepts what is actually legal', () => {
  const legal = [
    'c:r t:creature kw:haste mv<=3',
    't:legend',
    't:wizar',
    'c>=uw id<=bant',
    'pow>tou',
    'mv:even',
    'r>=rare f:modern usd<5',
    'o:"draw a card" -is:reprint',
    'set:neo OR set:chk',
    'is:fetchland has:watermark in:booster',
    'name:/^Lightning Bolt$/',
    'order:usd direction:asc unique:cards',
    'loy=3 devotion:{u}{u} m:{2}{r}{r}',
    'a:"rebecca guay" ft:"the beginning" wm:izzet',
    'year>=2020 date>=2021-01-01 st:commander block:chk',
  ];

  for (const query of legal) {
    it(query, () => {
      assert.deepEqual(errors(query), []);
    });
  }
});

describe('lint: never rejects what it could not read', () => {
  it('falls through instead of reporting errors when parsing fails', () => {
    const result = lintQuery('c:r (t:goblin stamp:foil', index);
    assert.equal(result.confident, false);
    assert.equal(result.ok, true, 'an unparsed query must not be rejected');
    assert.deepEqual(
      result.issues.filter((i) => i.severity === 'error'),
      [],
    );
  });

  it('treats unknown is: values as notes, since that vocabulary has no catalog', () => {
    const result = lintQuery('is:somethingnewscryfalladded', index);
    assert.equal(result.ok, true);
    assert.equal(result.issues.some((i) => i.severity === 'note'), true);
  });

  it('never errors on free-text fields', () => {
    assert.deepEqual(errors('o:"any words at all" a:nobody ft:whatever'), []);
  });
});

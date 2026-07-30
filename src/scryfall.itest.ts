import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { GroundingIndex } from './grounding/types.ts';
import { lintQuery } from './lint/lint.ts';
import { buildScryfallUrl, probeQuery, resolveLocalizedName, scryfallCallCount } from './scryfall.ts';

/**
 * Hits the live Scryfall API. Needs network but no credentials, so it runs separately from the
 * unit suite via `npm run test:integration`.
 */

const index = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'grounding', 'snapshot.json'), 'utf-8'),
) as GroundingIndex;

describe('probe classification', () => {
  it('treats a 200 carrying warnings as failure, not success', async () => {
    const result = await probeQuery('t:creature cmc:banana');
    assert.equal(result.status, 'ignored-terms');
    assert.ok(result.warnings.length > 0, 'expected Scryfall to report the ignored term');
    assert.ok((result.totalCards ?? 0) > 1000, 'the trap is that it still returns a full result set');
  });

  it('classifies an all-terms-ignored query as a parse error', async () => {
    const result = await probeQuery('kw:frobnicate');
    assert.equal(result.status, 'parse-error');
  });

  it('classifies a valid but unmatched query as empty rather than broken', async () => {
    const result = await probeQuery('set:neo t:goblin t:angel');
    assert.equal(result.status, 'empty');
  });

  it('accepts a clean query', async () => {
    const result = await probeQuery('c:r t:creature kw:haste mv<=3');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.warnings, []);
  });

  it('confirms an invalid set code produces no warning at all, which is why the linter must catch it', async () => {
    const result = await probeQuery('set:notarealset');
    assert.equal(result.status, 'empty');
    assert.deepEqual(result.warnings, [], 'Scryfall stays silent here — only the local whitelist catches this');
  });
});

describe('lint runs before the network', () => {
  it('rejects an unavailable filter without spending a Scryfall call', () => {
    const before = scryfallCallCount();
    const result = lintQuery('t:creature stamp:foil', index);
    assert.equal(result.ok, false);
    assert.equal(scryfallCallCount(), before, 'linting must not touch the network');
  });
});

describe('localized card names', () => {
  for (const [printed, expected] of [
    ['Blitzschlag', 'Lightning Bolt'],
    ['Fulmine', 'Lightning Bolt'],
  ] as const) {
    it(`resolves ${printed} to ${expected}`, async () => {
      const matches = await resolveLocalizedName(printed);
      assert.ok(
        matches.some((match) => match.name === expected),
        `expected an exact printed_name match for ${printed}, got ${JSON.stringify(matches)}`,
      );
    });
  }

  it('the canonical name works in a default session, the localized one does not', async () => {
    const localized = await probeQuery('Fulmine');
    const canonical = await probeQuery('!"Lightning Bolt"');
    assert.equal(localized.status, 'empty', 'a localized name finds nothing without include_multilingual');
    assert.equal(canonical.status, 'ok');
  });

  it('builds a correctly encoded scryfall.com URL', () => {
    const url = buildScryfallUrl('c:r t:creature kw:"double strike"');
    assert.equal(url, 'https://scryfall.com/search?q=c%3Ar+t%3Acreature+kw%3A%22double+strike%22');
  });
});

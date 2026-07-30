import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LANGUAGES, type Language } from '../src/prompt/examples/index.ts';
import { fetchResultSet } from '../src/scryfall.ts';
import { translateRequest } from '../src/translate.ts';

interface EvalCase {
  lang: Language;
  nl: string;
  expectedQuery?: string;
  expectQueryContains?: string;
  expectNoLangFilter?: boolean;
  expectLangFilter?: boolean;
  expectUnsupported?: boolean;
  previous?: { text: string; query: string };
  note?: string;
}

type Verdict = 'exact' | 'equivalent' | 'divergent' | 'invalid' | 'passed' | 'failed';

interface Outcome {
  case: EvalCase;
  verdict: Verdict;
  produced: string;
  detail?: string;
}

const CONCURRENCY = 4;

function loadCases(): EvalCase[] {
  const file = path.join(import.meta.dirname, 'cases.jsonl');
  return readFileSync(file, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvalCase);
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

function hasLangFilter(query: string): boolean {
  return /(^|\s|\()-?(lang|language)[:=]/i.test(query);
}

async function grade(testCase: EvalCase): Promise<Outcome> {
  const result = await translateRequest({
    text: testCase.nl,
    language: testCase.lang,
    ...(testCase.previous ? { previous: testCase.previous } : {}),
  });
  const produced = result.query;

  if (result.warnings.length > 0) {
    return { case: testCase, verdict: 'invalid', produced, detail: result.warnings.join('; ') };
  }

  if (testCase.expectUnsupported) {
    const flagged = result.unsupported.length > 0;
    return {
      case: testCase,
      verdict: flagged ? 'passed' : 'failed',
      produced,
      detail: flagged ? result.unsupported.join('; ') : 'nothing reported as unsupported',
    };
  }

  if (testCase.expectNoLangFilter && hasLangFilter(produced)) {
    return { case: testCase, verdict: 'failed', produced, detail: 'added a lang: filter for the input language' };
  }
  if (testCase.expectLangFilter && !hasLangFilter(produced)) {
    return { case: testCase, verdict: 'failed', produced, detail: 'expected a lang: filter' };
  }

  if (testCase.expectQueryContains) {
    const ok = produced.toLowerCase().includes(testCase.expectQueryContains.toLowerCase());
    return {
      case: testCase,
      verdict: ok ? 'passed' : 'failed',
      produced,
      detail: ok ? undefined : `expected to contain "${testCase.expectQueryContains}"`,
    };
  }

  if (!testCase.expectedQuery) {
    return { case: testCase, verdict: 'passed', produced };
  }

  if (normalizeQuery(produced) === normalizeQuery(testCase.expectedQuery)) {
    return { case: testCase, verdict: 'exact', produced };
  }

  const [expected, actual] = await Promise.all([
    fetchResultSet(testCase.expectedQuery),
    fetchResultSet(produced),
  ]);

  if (!actual) return { case: testCase, verdict: 'invalid', produced, detail: 'produced query rejected by Scryfall' };
  if (!expected) {
    return { case: testCase, verdict: 'divergent', produced, detail: 'expected query in the case file is itself invalid' };
  }

  const sameSet =
    expected.totalCards === actual.totalCards &&
    expected.oracleIds.length === actual.oracleIds.length &&
    expected.oracleIds.every((id, i) => id === actual.oracleIds[i]);

  return sameSet
    ? { case: testCase, verdict: 'equivalent', produced }
    : {
        case: testCase,
        verdict: 'divergent',
        produced,
        detail: `expected ${String(expected.totalCards)} cards, got ${String(actual.totalCards)}`,
      };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const PASSING: ReadonlySet<Verdict> = new Set<Verdict>(['exact', 'equivalent', 'passed']);

const cases = loadCases();
console.log(`Running ${String(cases.length)} cases…\n`);

const outcomes = await mapLimited(cases, CONCURRENCY, async (testCase) => {
  try {
    const outcome = await grade(testCase);
    const mark = PASSING.has(outcome.verdict) ? '✓' : '✗';
    console.log(`${mark} [${testCase.lang}] ${testCase.nl}`);
    if (!PASSING.has(outcome.verdict)) {
      console.log(`    got:      ${outcome.produced}`);
      if (testCase.expectedQuery) console.log(`    expected: ${testCase.expectedQuery}`);
      if (outcome.detail) console.log(`    ${outcome.verdict}: ${outcome.detail}`);
    }
    return outcome;
  } catch (error) {
    console.log(`✗ [${testCase.lang}] ${testCase.nl}`);
    console.log(`    error: ${error instanceof Error ? error.message : String(error)}`);
    return { case: testCase, verdict: 'failed' as Verdict, produced: '', detail: 'threw' };
  }
});

const verdicts: Verdict[] = ['exact', 'equivalent', 'passed', 'divergent', 'failed', 'invalid'];

console.log('\n─── totals ───');
for (const verdict of verdicts) {
  const count = outcomes.filter((o) => o.verdict === verdict).length;
  if (count > 0) console.log(`${verdict.padEnd(12)} ${String(count)}`);
}

const passed = outcomes.filter((o) => PASSING.has(o.verdict)).length;
console.log(`\npass rate    ${String(passed)}/${String(outcomes.length)} (${((passed / outcomes.length) * 100).toFixed(1)}%)`);

console.log('\n─── by language ───');
for (const lang of LANGUAGES) {
  const forLang = outcomes.filter((o) => o.case.lang === lang);
  if (forLang.length === 0) continue;
  const ok = forLang.filter((o) => PASSING.has(o.verdict)).length;
  console.log(`${lang}  ${String(ok)}/${String(forLang.length)}`);
}

process.exit(passed === outcomes.length ? 0 : 1);

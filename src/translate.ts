import { PROMPT_VERSION, repair, translate as callModel, type Translation } from './claude.ts';
import { getGroundingIndex } from './grounding/index.ts';
import { findCandidates, renderCandidates } from './grounding/match.ts';
import { applyResolution, resolveCardName } from './grounding/names.ts';
import { INDEX_VERSION } from './grounding/types.ts';
import { config } from './config.ts';
import { formatIssues, lintQuery, type LintResult } from './lint/lint.ts';
import { buildScryfallUrl, probeQuery, scryfallCallCount, type ProbeResult } from './scryfall.ts';
import { cacheKey, readCache, writeCache } from './store/cache.ts';

export interface TranslateInput {
  text: string;
  language?: string;
  previous?: { text: string; query: string };
}

export interface TranslateOutput {
  query: string;
  scryfallUrl: string;
  detectedLanguage: string;
  assumptions: string[];
  unsupported: string[];
  notes: string[];
  warnings: string[];
  diagnostics: {
    cached: boolean;
    modelCalls: number;
    scryfallCalls: number;
    repaired: boolean;
  };
}

interface Attempt {
  translation: Translation;
  query: string;
  notes: string[];
  lint: LintResult;
  probe?: ProbeResult;
  problem?: string;
}

/** Substitutes canonical English names so the returned filter works in a default Scryfall session. */
async function resolveNames(translation: Translation): Promise<{ query: string; notes: string[] }> {
  let query = translation.query;
  const notes: string[] = [];

  for (const detected of translation.detectedNames.slice(0, 5)) {
    if (!query.toLowerCase().includes(detected.toLowerCase())) continue;

    const resolution = await resolveCardName(detected);
    switch (resolution.status) {
      case 'english':
        query = applyResolution(query, detected, resolution.canonical);
        break;
      case 'resolved':
        query = applyResolution(query, detected, resolution.canonical);
        notes.push(`"${detected}" → ${resolution.canonical}`);
        break;
      case 'ambiguous':
        notes.push(`"${detected}" matches several cards: ${resolution.candidates.slice(0, 5).join(', ')}`);
        break;
      case 'unknown':
        notes.push(`"${detected}" did not match a known card name`);
        break;
    }
  }

  return { query, notes };
}

function describeProbe(probe: ProbeResult): string | undefined {
  if (probe.status === 'ok' || probe.status === 'empty') return undefined;
  const lines = probe.warnings.map((warning) => `- ${warning}`);
  if (probe.details) lines.push(`- ${probe.details}`);
  return probe.status === 'parse-error'
    ? `Scryfall could not parse it:\n${lines.join('\n')}`
    : `Scryfall silently ignored part of it, which means the results would not match the request:\n${lines.join('\n')}`;
}

/**
 * Lint first, probe second. A query rejected locally never reaches Scryfall, which is what keeps
 * the common failure — an invented key or a mistranslated value — free.
 */
async function evaluate(translation: Translation, indexPromise: ReturnType<typeof getGroundingIndex>): Promise<Attempt> {
  const index = await indexPromise;
  const { query, notes } = await resolveNames(translation);
  const lint = lintQuery(query, index);

  if (!lint.ok) {
    return { translation, query, notes, lint, problem: formatIssues(lint.issues) };
  }

  const probe = await probeQuery(query);
  return { translation, query, notes, lint, probe, problem: describeProbe(probe) };
}

export async function translateRequest(input: TranslateInput): Promise<TranslateOutput> {
  const text = input.text.trim();
  const key = cacheKey({
    text,
    ...(input.previous ? { previousQuery: input.previous.query } : {}),
    model: config.model,
    promptVersion: PROMPT_VERSION,
    indexVersion: INDEX_VERSION,
  });

  const cached = await readCache(key);
  if (cached) {
    return {
      query: cached.query,
      scryfallUrl: buildScryfallUrl(cached.query),
      detectedLanguage: cached.detectedLanguage,
      assumptions: cached.assumptions,
      unsupported: cached.unsupported,
      notes: cached.notes,
      warnings: cached.warnings,
      diagnostics: { cached: true, modelCalls: 0, scryfallCalls: 0, repaired: false },
    };
  }

  const scryfallBefore = scryfallCallCount();
  const indexPromise = getGroundingIndex();
  const index = await indexPromise;
  const candidates = renderCandidates(findCandidates(text, index));

  const request = {
    text,
    candidates,
    ...(input.previous ? { previous: input.previous } : {}),
  };

  let modelCalls = 1;
  let attempt = await evaluate(await callModel(request), indexPromise);
  let repaired = false;

  if (attempt.problem) {
    modelCalls += 1;
    repaired = true;
    const retried = await repair({ ...request, failed: attempt.translation, problem: attempt.problem });
    const second = await evaluate(retried, indexPromise);
    // Keep the repaired attempt only if it actually improved things.
    if (!second.problem || attempt.problem) attempt = second;
  }

  const notes = [...attempt.notes];
  if (attempt.probe?.status === 'empty') {
    notes.push('This query is valid but currently matches no cards on Scryfall.');
  }
  if (!attempt.lint.confident) {
    notes.push('The query was too complex to verify locally; it was checked against Scryfall only.');
  }

  const warnings = attempt.problem ? [attempt.problem] : [];

  const output: TranslateOutput = {
    query: attempt.query,
    scryfallUrl: buildScryfallUrl(attempt.query),
    detectedLanguage: attempt.translation.detectedLanguage,
    assumptions: attempt.translation.assumptions,
    unsupported: attempt.translation.unsupported,
    notes,
    warnings,
    diagnostics: {
      cached: false,
      modelCalls,
      scryfallCalls: scryfallCallCount() - scryfallBefore,
      repaired,
    },
  };

  // A query we could not validate is not worth remembering.
  if (warnings.length === 0) {
    await writeCache(key, {
      query: output.query,
      detectedLanguage: output.detectedLanguage,
      assumptions: output.assumptions,
      unsupported: output.unsupported,
      notes: output.notes,
      warnings: output.warnings,
    });
  }

  return output;
}

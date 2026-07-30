import type { GroundingIndex } from '../grounding/types.ts';
import {
  COLOR_VOCABULARY,
  allOperatorNames,
  lookupOperator,
  type OperatorSpec,
  type ValueDomain,
} from '../registry/operators.ts';
import { tokenize, type FilterToken } from './tokenize.ts';

export interface LintIssue {
  severity: 'error' | 'note';
  term: string;
  message: string;
}

export interface LintResult {
  /** False only when at least one error was found; notes never block. */
  ok: boolean;
  confident: boolean;
  issues: LintIssue[];
}

const STAT_REFS = new Set(['pow', 'power', 'tou', 'toughness', 'loy', 'loyalty', 'cmc', 'mv', 'manavalue']);

function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i += 1) {
    const curr = [i, ...Array.from<number>({ length: cols - 1 }).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[cols - 1]!;
}

function nearest(value: string, vocabulary: readonly string[]): string | undefined {
  const target = value.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of vocabulary) {
    const score = distance(target, candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const tolerance = Math.max(2, Math.floor(target.length / 3));
  return bestScore <= tolerance ? best : undefined;
}

function sample(values: readonly string[], limit = 12): string {
  const shown = values.slice(0, limit).join(', ');
  return values.length > limit ? `${shown}, …` : shown;
}

function catalogValues(catalog: string, index: GroundingIndex): readonly string[] {
  switch (catalog) {
    case 'keywords':
      return index.keywords;
    case 'types':
      return index.types;
    case 'watermarks':
      return index.watermarks;
    case 'sets':
      return index.sets.map((set) => set.code);
    default:
      return [];
  }
}

function checkValue(
  token: FilterToken,
  spec: OperatorSpec,
  domain: ValueDomain,
  index: GroundingIndex,
): LintIssue | undefined {
  const value = token.value.trim();
  if (value.length === 0) {
    return { severity: 'error', term: token.raw, message: `\`${spec.key}\` was given no value.` };
  }
  const lowered = value.toLowerCase();

  switch (domain.kind) {
    case 'enum': {
      if (domain.values.includes(lowered)) return undefined;
      const suggestion = nearest(lowered, domain.values);
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : '';
      if (!domain.strict) {
        return {
          severity: 'note',
          term: token.raw,
          message: `\`${lowered}\` is not a recognised \`${spec.key}\` value.${hint}`,
        };
      }
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${lowered}\` is not a valid \`${spec.key}\` value.${hint} Allowed: ${sample(domain.values)}.`,
      };
    }

    case 'catalog': {
      if (token.regex) return undefined;
      const values = catalogValues(domain.catalog, index);
      if (values.some((entry) => entry.toLowerCase() === lowered)) return undefined;
      const suggestion = nearest(lowered, values);
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : '';
      if (!domain.strict) {
        return {
          severity: 'note',
          term: token.raw,
          message: `\`${lowered}\` is not a known ${domain.catalog} value.${hint}`,
        };
      }
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${lowered}\` is not a valid ${domain.catalog} value for \`${spec.key}\`.${hint}`,
      };
    }

    case 'typeLine': {
      if (token.regex || token.quoted) return undefined;
      // `t:` matches substrings of the type line, so `t:legend` is legitimate. Testing for a
      // substring relationship is therefore the precise check: it accepts real partial words and
      // still catches untranslated vocabulary like `t:cavaliere`.
      if (index.types.some((type) => type.includes(lowered) || lowered.includes(type))) return undefined;
      const suggestion = nearest(lowered, index.types);
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : '';
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${lowered}\` does not appear in any Magic type line.${hint}`,
      };
    }

    case 'color': {
      if (COLOR_VOCABULARY.includes(lowered)) return undefined;
      if (/^[wubrgcm]+$/.test(lowered)) return undefined;
      if (/^\d+$/.test(lowered)) return undefined;
      const suggestion = nearest(lowered, COLOR_VOCABULARY);
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : '';
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${lowered}\` is not a colour.${hint} Use letters (w,u,b,r,g,c) or a name like \`azorius\`.`,
      };
    }

    case 'integer': {
      if (/^-?\d+$/.test(lowered)) return undefined;
      if (domain.allowParity && (lowered === 'even' || lowered === 'odd')) return undefined;
      if (domain.allowStar && /^[\d*+\-/ ]+$/.test(lowered)) return undefined;
      if (domain.allowStatRef && STAT_REFS.has(lowered)) return undefined;
      const extras = [
        domain.allowParity ? 'even/odd' : undefined,
        domain.allowStar ? '*' : undefined,
        domain.allowStatRef ? 'another stat' : undefined,
      ].filter(Boolean);
      const allowed = extras.length > 0 ? ` (or ${extras.join(', ')})` : '';
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${spec.key}\` needs a number${allowed}, got \`${value}\`.`,
      };
    }

    case 'decimal': {
      if (/^\d+(\.\d+)?$/.test(lowered)) return undefined;
      return {
        severity: 'error',
        term: token.raw,
        message: `\`${spec.key}\` needs a numeric amount, got \`${value}\`.`,
      };
    }

    case 'date': {
      if (/^\d{4}$/.test(lowered)) return undefined;
      if (/^\d{4}-\d{2}-\d{2}$/.test(lowered)) return undefined;
      if (index.sets.some((set) => set.code === lowered)) return undefined;
      return {
        severity: 'note',
        term: token.raw,
        message: `\`${value}\` is not a year, an ISO date, or a known set code.`,
      };
    }

    case 'mana':
    case 'text':
      return undefined;
  }
}

export function lintQuery(query: string, index: GroundingIndex): LintResult {
  const { tokens, confident, reason } = tokenize(query);

  if (!confident) {
    return {
      ok: true,
      confident: false,
      issues: reason ? [{ severity: 'note', term: query, message: `Not fully parsed (${reason}).` }] : [],
    };
  }

  const issues: LintIssue[] = [];

  for (const token of tokens) {
    if (token.type !== 'filter') continue;

    const spec = lookupOperator(token.key);
    if (!spec) {
      const suggestion = nearest(token.key, allOperatorNames());
      const hint = suggestion ? ` Did you mean \`${suggestion}\`?` : '';
      issues.push({
        severity: 'error',
        term: token.raw,
        message: `\`${token.key}:\` is not an available filter in this tool.${hint}`,
      });
      continue;
    }

    if (!spec.comparisons.includes(token.comparison)) {
      issues.push({
        severity: 'note',
        term: token.raw,
        message: `\`${spec.key}\` normally uses ${spec.comparisons.join(' ')}, got \`${token.comparison}\`.`,
      });
    }

    const issue = checkValue(token, spec, spec.domain, index);
    if (issue) issues.push(issue);
  }

  return { ok: !issues.some((issue) => issue.severity === 'error'), confident: true, issues };
}

export function formatIssues(issues: readonly LintIssue[]): string {
  return issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => `- ${issue.term} — ${issue.message}`)
    .join('\n');
}

import type { Comparison } from '../registry/operators.ts';

export interface FilterToken {
  type: 'filter';
  key: string;
  comparison: Comparison;
  value: string;
  quoted: boolean;
  regex: boolean;
  negated: boolean;
  raw: string;
}

export interface BareToken {
  type: 'bare';
  value: string;
  quoted: boolean;
  regex: boolean;
  negated: boolean;
  raw: string;
}

export interface StructuralToken {
  type: 'group-open' | 'group-close' | 'or' | 'and';
  raw: string;
}

export type Token = FilterToken | BareToken | StructuralToken;

export interface TokenizeResult {
  tokens: Token[];
  /**
   * False when the scanner hit something it could not account for. The linter must not report
   * errors in that case — a query it failed to read is not a query it has judged.
   */
  confident: boolean;
  reason?: string;
}

const COMPARISONS: Comparison[] = ['<=', '>=', '!=', ':', '=', '<', '>'];

interface Scanned {
  text: string;
  end: number;
  ok: boolean;
}

function scanTerm(input: string, start: number): Scanned {
  let i = start;
  let quote: string | undefined;
  let inRegex = false;
  let out = '';

  while (i < input.length) {
    const ch = input[i]!;

    if (quote) {
      out += ch;
      if (ch === quote) quote = undefined;
      i += 1;
      continue;
    }

    if (inRegex) {
      out += ch;
      if (ch === '\\' && i + 1 < input.length) {
        out += input[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === '/') inRegex = false;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    // A slash only opens a regex at the start of a term or straight after a comparison.
    if (ch === '/' && (out.length === 0 || /[:=<>!]$/.test(out))) {
      inRegex = true;
      out += ch;
      i += 1;
      continue;
    }

    if (/\s/.test(ch) || ch === '(' || ch === ')') break;

    out += ch;
    i += 1;
  }

  return { text: out, end: i, ok: quote === undefined && !inRegex };
}

function splitFilter(term: string): { key: string; comparison: Comparison; value: string } | undefined {
  for (const comparison of COMPARISONS) {
    const at = term.indexOf(comparison);
    if (at <= 0) continue;
    const key = term.slice(0, at);
    if (!/^[A-Za-z]+$/.test(key)) continue;
    return { key, comparison, value: term.slice(at + comparison.length) };
  }
  return undefined;
}

function unwrap(value: string): { value: string; quoted: boolean; regex: boolean } {
  if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0]!)) {
    return { value: value.slice(1, -1), quoted: true, regex: false };
  }
  if (value.length >= 2 && value.startsWith('/') && value.endsWith('/')) {
    return { value: value.slice(1, -1), quoted: false, regex: true };
  }
  return { value, quoted: false, regex: false };
}

export function tokenize(query: string): TokenizeResult {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;

  while (i < query.length) {
    const ch = query[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'group-open', raw: ch });
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === ')') {
      depth -= 1;
      if (depth < 0) return { tokens, confident: false, reason: 'unbalanced closing parenthesis' };
      tokens.push({ type: 'group-close', raw: ch });
      i += 1;
      continue;
    }

    let negated = false;
    let termStart = i;
    if (ch === '-') {
      negated = true;
      termStart = i + 1;
    }

    const scanned = scanTerm(query, termStart);
    if (!scanned.ok) return { tokens, confident: false, reason: 'unterminated quote or regex' };
    if (scanned.text.length === 0) {
      // A lone '-' or a character the scanner cannot classify.
      return { tokens, confident: false, reason: `unreadable term at position ${String(i)}` };
    }

    const raw = query.slice(i, scanned.end);
    i = scanned.end;

    const lowered = scanned.text.toLowerCase();
    if (!negated && (lowered === 'or' || lowered === 'and')) {
      tokens.push({ type: lowered, raw });
      continue;
    }

    const split = splitFilter(scanned.text);
    if (split) {
      const { value, quoted, regex } = unwrap(split.value);
      tokens.push({
        type: 'filter',
        key: split.key.toLowerCase(),
        comparison: split.comparison,
        value,
        quoted,
        regex,
        negated,
        raw,
      });
      continue;
    }

    const { value, quoted, regex } = unwrap(scanned.text);
    tokens.push({ type: 'bare', value, quoted, regex, negated, raw });
  }

  if (depth !== 0) return { tokens, confident: false, reason: 'unbalanced parentheses' };
  return { tokens, confident: true };
}

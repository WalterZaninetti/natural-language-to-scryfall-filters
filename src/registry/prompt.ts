import { OPERATORS, type OperatorSpec } from './operators.ts';

function describeDomain(spec: OperatorSpec): string {
  const domain = spec.domain;
  switch (domain.kind) {
    case 'enum':
      return domain.values.length <= 26
        ? `one of: ${domain.values.join(', ')}`
        : `one of ${String(domain.values.length)} values, e.g. ${domain.values.slice(0, 14).join(', ')}, …`;
    case 'catalog':
      return `a valid ${domain.catalog} value (checked against Scryfall's catalog)`;
    case 'typeLine':
      return 'any word from a type line; partial words match';
    case 'color':
      return 'colour letters (w,u,b,r,g,c) combined, or a colour/guild/shard name';
    case 'mana':
      return 'mana symbols, e.g. {2}{r}{r}';
    case 'integer': {
      const extras = [
        domain.allowParity ? 'even/odd' : undefined,
        domain.allowStar ? '*' : undefined,
        domain.allowStatRef ? 'another stat name' : undefined,
      ].filter(Boolean);
      return extras.length > 0 ? `a number, or ${extras.join(' / ')}` : 'a number';
    }
    case 'decimal':
      return 'a decimal amount';
    case 'date':
      return 'a year, an ISO date, or a set code';
    case 'text':
      return 'free text (quote it if it contains spaces)';
  }
}

/**
 * Rendered from the same module the linter validates against, so the model can never be told a
 * vocabulary the validator disagrees with.
 */
export function renderOperatorTable(): string {
  const groups = new Map<string, OperatorSpec[]>();
  for (const spec of OPERATORS) {
    const bucket = groups.get(spec.group) ?? [];
    bucket.push(spec);
    groups.set(spec.group, bucket);
  }

  const lines: string[] = [];
  for (const [group, specs] of groups) {
    lines.push(`### ${group}`);
    for (const spec of specs) {
      const names = [spec.key, ...spec.aliases].join(' | ');
      lines.push(
        `- \`${names}\` — ${spec.summary}`,
        `  operators: ${spec.comparisons.join(' ')} · value: ${describeDomain(spec)} · e.g. \`${spec.example}\``,
      );
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

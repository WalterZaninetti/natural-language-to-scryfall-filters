const BASE = 'https://api.scryfall.com';
const USER_AGENT = 'natural-language-to-scryfall-filters/0.1 (+https://github.com/walterzaninetti)';
const MIN_GAP_MS = 100;

let gate: Promise<unknown> = Promise.resolve();
let lastCall = 0;

/** Scryfall asks for 50–100ms between requests, so every call goes through one serial gate. */
function throttled<T>(run: () => Promise<T>): Promise<T> {
  const next = gate.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();
    return run();
  });
  gate = next.catch(() => undefined);
  return next;
}

export class ScryfallError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ScryfallError';
    this.status = status;
  }
}

interface ScryfallEnvelope {
  object?: string;
  code?: string;
  status?: number;
  details?: string;
  warnings?: string[];
  total_cards?: number;
  data?: unknown[];
}

let calls = 0;

/** Lets the pipeline report — and tests assert — that a lint rejection cost no Scryfall traffic. */
export function scryfallCallCount(): number {
  return calls;
}

async function request(path: string, params: Record<string, string> = {}): Promise<{ body: ScryfallEnvelope; status: number }> {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  calls += 1;

  return throttled(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: ScryfallEnvelope;
    try {
      body = JSON.parse(text) as ScryfallEnvelope;
    } catch {
      throw new ScryfallError(`Non-JSON response from Scryfall (${String(response.status)})`, response.status);
    }
    return { body, status: response.status };
  });
}

export type ProbeStatus = 'ok' | 'ignored-terms' | 'parse-error' | 'empty';

export interface ProbeResult {
  status: ProbeStatus;
  /** Scryfall's own wording, passed verbatim into the repair prompt. */
  warnings: string[];
  details?: string;
  totalCards?: number;
}

/**
 * A 200 carrying `warnings` is a failure, not a hint: Scryfall silently drops terms it cannot
 * parse and returns a full result set for whatever is left. Accepting that response would hand
 * the user a query that looks fine and matches the wrong cards.
 *
 * Deliberately does not send include_multilingual, so this checks the query in the same
 * configuration as the browser the "open in Scryfall" link will land in.
 */
export async function probeQuery(query: string): Promise<ProbeResult> {
  const { body, status } = await request('/cards/search', { q: query });
  const warnings = body.warnings ?? [];

  if (status === 400) {
    return { status: 'parse-error', warnings, details: body.details };
  }
  if (status === 404) {
    return { status: 'empty', warnings, details: body.details };
  }
  if (status !== 200) {
    throw new ScryfallError(body.details ?? `Scryfall returned ${String(status)}`, status);
  }
  if (warnings.length > 0) {
    return { status: 'ignored-terms', warnings, details: body.details, totalCards: body.total_cards };
  }
  return { status: 'ok', warnings: [], totalCards: body.total_cards };
}

/** Exact English name lookup. Returns the canonical name, or null when Scryfall has no such card. */
export async function findEnglishName(name: string): Promise<string | null> {
  const { body, status } = await request('/cards/named', { exact: name });
  if (status !== 200) return null;
  const card = body as unknown as { name?: string };
  return card.name ?? null;
}

export interface MultilingualMatch {
  name: string;
  printedName: string;
  lang: string;
}

/**
 * Localized names only resolve with include_multilingual, which is a URL parameter and therefore
 * cannot travel inside the `q` string we hand back. So a localized name has to be turned into its
 * English canonical name here, or the resulting scryfall.com link finds nothing.
 *
 * The search is a substring match across every language ("Fulmine" alone returns 44 cards), so
 * only an exact printed_name hit is trusted; anything else is reported as ambiguous.
 */
export async function resolveLocalizedName(name: string): Promise<MultilingualMatch[]> {
  const { body, status } = await request('/cards/search', {
    q: name,
    include_multilingual: 'true',
    unique: 'cards',
  });
  if (status !== 200 || !Array.isArray(body.data)) return [];

  const target = name.trim().toLowerCase();
  const matches: MultilingualMatch[] = [];
  for (const raw of body.data) {
    const card = raw as { name?: string; printed_name?: string; lang?: string };
    if (!card.name || !card.printed_name) continue;
    if (card.printed_name.trim().toLowerCase() !== target) continue;
    if (matches.some((m) => m.name === card.name)) continue;
    matches.push({ name: card.name, printedName: card.printed_name, lang: card.lang ?? 'unknown' });
  }
  return matches;
}

export interface ResultSet {
  totalCards: number;
  oracleIds: string[];
}

/**
 * Grading material for the evals. Two queries that spell the same intent differently
 * (`t:creature c:r` vs `type:creature color:red`) must count as equal, so comparison is on the
 * cards returned rather than on the query text.
 */
export async function fetchResultSet(query: string): Promise<ResultSet | undefined> {
  const { body, status } = await request('/cards/search', { q: query, order: 'name', unique: 'cards' });
  if (status === 404) return { totalCards: 0, oracleIds: [] };
  if (status !== 200 || (body.warnings?.length ?? 0) > 0 || !Array.isArray(body.data)) return undefined;

  const oracleIds = body.data
    .map((raw) => (raw as { oracle_id?: string }).oracle_id)
    .filter((id): id is string => typeof id === 'string')
    .sort();

  return { totalCards: body.total_cards ?? oracleIds.length, oracleIds };
}

export async function fetchCatalog(name: string): Promise<string[]> {
  const { body, status } = await request(`/catalog/${name}`);
  if (status !== 200 || !Array.isArray(body.data)) {
    throw new ScryfallError(`Catalog ${name} unavailable (${String(status)})`, status);
  }
  return body.data as string[];
}

export interface RawSet {
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  block?: string;
  block_code?: string;
  parent_set_code?: string;
  digital?: boolean;
}

export async function fetchSets(): Promise<RawSet[]> {
  const { body, status } = await request('/sets');
  if (status !== 200 || !Array.isArray(body.data)) {
    throw new ScryfallError(`Sets unavailable (${String(status)})`, status);
  }
  return body.data as RawSet[];
}

export function buildScryfallUrl(query: string): string {
  const url = new URL('https://scryfall.com/search');
  url.searchParams.set('q', query);
  return url.toString();
}

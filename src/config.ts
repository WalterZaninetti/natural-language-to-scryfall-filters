function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * Express reads `trust proxy` as a hop count, a boolean, or a subnet list. Leaving it empty
 * keeps Express's default (off), which is the only safe choice when nothing sits in front:
 * trusting X-Forwarded-For unconditionally lets any caller forge an IP and mint fresh
 * rate-limit buckets at will.
 */
function trustProxySetting(): number | boolean | string | undefined {
  const raw = optional('TRUST_PROXY', '').trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

export const config = {
  port: Number(optional('PORT', '8080')),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  clientApiKey: required('API_KEY'),
  trustProxy: trustProxySetting(),
  model: optional('ANTHROPIC_MODEL', 'claude-sonnet-5'),
  effort: optional('ANTHROPIC_EFFORT', 'low'),
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitPerHour: Number(optional('RATE_LIMIT_PER_HOUR', '15')),
} as const;

export type Config = typeof config;

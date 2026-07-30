function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional('PORT', '8080')),
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  model: optional('ANTHROPIC_MODEL', 'claude-opus-5'),
  effort: optional('ANTHROPIC_EFFORT', 'medium'),
  allowedOrigins: optional('ALLOWED_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitPerHour: Number(optional('RATE_LIMIT_PER_HOUR', '60')),
} as const;

export type Config = typeof config;

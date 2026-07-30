import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod';
import { config } from './config.ts';
import { LANGUAGES, renderExamples } from './prompt/examples/index.ts';
import { SEMANTICS } from './prompt/semantics.ts';
import { renderOperatorTable } from './registry/prompt.ts';
import { REGISTRY_VERSION } from './registry/operators.ts';

export const TranslationSchema = z.object({
  query: z.string().describe('The Scryfall search query. English syntax only.'),
  detectedLanguage: z.enum(LANGUAGES),
  detectedNames: z.array(z.string()).describe('Card names mentioned by the user, as they wrote them.'),
  assumptions: z.array(z.string()).describe("Interpretation choices, in the user's language."),
  unsupported: z.array(z.string()).describe("Requested things this tool cannot express, in the user's language."),
});

export type Translation = z.infer<typeof TranslationSchema>;

/**
 * Built once at module load and never interpolated with per-request data — a timestamp or request
 * id anywhere in here would change the bytes and silently cost every cache hit.
 */
const SYSTEM_PROMPT = `
You turn a natural-language request for Magic: The Gathering cards into a Scryfall search query.

You may only use the filters listed below. There are no others: any key not in this table is
unavailable, and emitting one is an error that will be rejected before the user sees it.

## Available filters

${renderOperatorTable()}

${SEMANTICS}

## Examples

${renderExamples()}
`.trim();

export const PROMPT_VERSION = `${String(REGISTRY_VERSION)}:${String(SYSTEM_PROMPT.length)}`;

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export interface TranslateRequest {
  text: string;
  candidates: string;
  previous?: { text: string; query: string };
}

export interface RepairRequest extends TranslateRequest {
  failed: Translation;
  problem: string;
}

function buildUserTurn(request: TranslateRequest): string {
  const parts: string[] = [];
  if (request.previous) {
    parts.push(
      `The user previously asked: ${request.previous.text}`,
      `That produced the query: ${request.previous.query}`,
      'Apply the new instruction below to that query, keeping the constraints that still apply.',
      '',
    );
  }
  if (request.candidates.length > 0) {
    parts.push('<resolved_entities>', request.candidates, '</resolved_entities>', '');
  }
  parts.push(`Request: ${request.text}`);
  return parts.join('\n');
}

async function call(messages: Anthropic.MessageParam[]): Promise<Translation> {
  const message = await client.messages.parse({
    model: config.model,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: config.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
      format: zodOutputFormat(TranslationSchema),
    },
    messages,
  });

  if (message.stop_reason === 'refusal') {
    throw new Error('The model declined this request.');
  }
  if (!message.parsed_output) {
    throw new Error(`Model returned no parseable output (stop_reason: ${String(message.stop_reason)})`);
  }
  return message.parsed_output;
}

export async function translate(request: TranslateRequest): Promise<Translation> {
  return call([{ role: 'user', content: buildUserTurn(request) }]);
}

/** The failure is fed back verbatim — a precise message repairs far more reliably than "try again". */
export async function repair(request: RepairRequest): Promise<Translation> {
  return call([
    { role: 'user', content: buildUserTurn(request) },
    { role: 'assistant', content: JSON.stringify(request.failed) },
    {
      role: 'user',
      content: [
        'That query was rejected:',
        request.problem,
        '',
        'Produce a corrected query using only the available filters.',
        'If part of the request genuinely cannot be expressed, drop that part and list it in `unsupported`.',
      ].join('\n'),
    },
  ]);
}

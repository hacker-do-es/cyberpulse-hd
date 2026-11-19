import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import type { AiProvider } from '../db/schema';
import { decryptSecret } from '../lib/crypto';
import { buildAiHostAllowlist, resolveAiBaseUrl } from '../lib/security';
import { tenantRepository } from '../repositories/tenantRepository';

/* One text-completion interface over the two providers a company can pick.
   Keys live server-side, encrypted per company, and never reach the browser. */

export type { AiProvider };

export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string | null;
}

export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/* Models that accept the server-side refusal fallback. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const AI_HOST_ALLOWLIST = buildAiHostAllowlist(config.aiHosts);

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function getTenantAiConfig(tenantId: number): AiConfig | null {
  const t = tenantRepository.findById(tenantId);
  if (!t || t.aiProvider === 'none' || !t.aiKey) return null;
  return {
    provider: t.aiProvider,
    model: t.aiModel || (t.aiProvider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL),
    apiKey: decryptSecret(t.aiKey),
    baseUrl: t.aiBaseUrl,
  };
}

export function validateOpenAiBaseUrl(raw: unknown): { url: string } | { error: string } {
  return resolveAiBaseUrl(raw, AI_HOST_ALLOWLIST);
}

export interface CompletionRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export async function complete(cfg: AiConfig, req: CompletionRequest): Promise<string> {
  if (cfg.provider === 'anthropic') return completeAnthropic(cfg, req);
  if (cfg.provider === 'openai') return completeOpenAi(cfg, req);
  throw new AiError('No AI provider configured for this company', 409);
}

async function completeAnthropic(cfg: AiConfig, req: CompletionRequest): Promise<string> {
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: 120_000, maxRetries: 2 });
  const useFallback = FALLBACK_MODELS.has(cfg.model);

  try {
    const response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      /* Digests and posts are short summarisation jobs; low effort keeps them
         fast and cheap without hurting quality. */
      output_config: { effort: 'low' },
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });

    if (response.stop_reason === 'refusal') {
      throw new AiError('The model declined to generate this content', 422);
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new AiError('Empty response from Claude');
    return text;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('Claude rejected the API key', 400);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('The Claude API key has no access to this model', 400);
    if (err instanceof Anthropic.NotFoundError) throw new AiError(`Unknown Claude model "${cfg.model}"`, 400);
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Claude rate limit reached, try again later', 429);
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`Claude rejected the request: ${err.message}`.slice(0, 300), 400);
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude API error ${err.status ?? ''}`.trim(), 502);
    throw new AiError('Could not reach the Claude API', 502);
  }
}

async function completeOpenAi(cfg: AiConfig, req: CompletionRequest): Promise<string> {
  const resolved = validateOpenAiBaseUrl(cfg.baseUrl);
  if ('error' in resolved) throw new AiError(resolved.error, 400);

  let response: Response;
  try {
    response = await fetch(`${resolved.url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        /* No token cap: newer OpenAI models reject max_tokens and some
           compatible hosts reject max_completion_tokens. */
        model: cfg.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new AiError('Could not reach the OpenAI API', 502);
  }

  if (response.status === 401) throw new AiError('OpenAI rejected the API key', 400);
  if (response.status === 404) throw new AiError(`Unknown OpenAI model "${cfg.model}"`, 400);
  if (response.status === 429) throw new AiError('OpenAI rate limit or quota reached', 429);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AiError(`OpenAI error ${response.status}: ${body.slice(0, 200)}`, 502);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new AiError('Empty response from OpenAI');
  return text.trim();
}

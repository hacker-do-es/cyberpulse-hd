import type express from 'express';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import { badRequest, conflict, HttpError, mask, optStr, tenantOf } from '../lib/http';
import { tenantRepository } from '../repositories/tenantRepository';
import {
  ANTHROPIC_MODELS, AiError, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL,
  complete, getTenantAiConfig, validateOpenAiBaseUrl,
} from '../services/ai';
import { rescheduleTenant } from '../services/channelSchedule';
import { isValidTimeZone } from '../services/schedule';

function settingsOut(tid: number) {
  const t = tenantRepository.findById(tid)!;
  const key = t.aiKey ? decryptSecret(t.aiKey) : '';
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    timezone: t.timezone,
    ai: {
      provider: t.aiProvider,
      model: t.aiModel || (t.aiProvider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL),
      baseUrl: t.aiBaseUrl || '',
      keySet: Boolean(key),
      keyHint: mask(key),
    },
    options: { anthropicModels: ANTHROPIC_MODELS, defaultOpenAiModel: DEFAULT_OPENAI_MODEL },
  };
}

export function aiErrorResponse(err: unknown, fallback: string): HttpError {
  const e = err instanceof AiError ? err : new AiError(fallback);
  return new HttpError(e.status >= 400 && e.status < 600 ? e.status : 502, e.message);
}

export const tenantSettingsController = {
  get(req: express.Request, res: express.Response) {
    res.json(settingsOut(tenantOf(req)));
  },

  update(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const body = req.body ?? {};
    const current = tenantRepository.findById(tid)!;

    const language = body.language === undefined ? current.language : body.language;
    if (language !== 'en' && language !== 'es') throw badRequest('language must be "es" or "en"');
    const timezone = body.timezone === undefined ? current.timezone : body.timezone;
    if (!isValidTimeZone(timezone)) throw badRequest('Unknown time zone');

    const ai = body.ai ?? {};
    const provider = ai.provider === undefined ? current.aiProvider : ai.provider;
    if (!['none', 'anthropic', 'openai'].includes(provider)) throw badRequest('Unknown AI provider');

    let model: string | null = ai.model === undefined ? current.aiModel : optStr(ai.model, 100);
    let baseUrl: string | null = ai.baseUrl === undefined ? current.aiBaseUrl : optStr(ai.baseUrl, 300);
    if (provider === 'anthropic') {
      model = model && (ANTHROPIC_MODELS as readonly string[]).includes(model) ? model : DEFAULT_ANTHROPIC_MODEL;
      baseUrl = null;
    } else if (provider === 'openai') {
      if (model && !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw badRequest('Invalid model name');
      model = model || DEFAULT_OPENAI_MODEL;
      if (baseUrl) {
        const v = validateOpenAiBaseUrl(baseUrl);
        if ('error' in v) throw badRequest(v.error);
        baseUrl = v.url;
      }
    } else {
      model = null;
      baseUrl = null;
    }

    /* The key is write-only: omitted keeps it, "" clears it. Switching
       provider without a new key clears the old one rather than sending a
       Claude key to OpenAI or the other way round. */
    let aiKey: string | null = current.aiKey;
    if (typeof ai.apiKey === 'string') {
      const k = ai.apiKey.trim();
      if (k.length > 500) throw badRequest('API key is too long');
      aiKey = k ? encryptSecret(k) : null;
    } else if (provider !== current.aiProvider) {
      aiKey = null;
    }
    if (provider === 'none') aiKey = null;

    tenantRepository.update(tid, { language, timezone, aiProvider: provider, aiModel: model, aiBaseUrl: baseUrl, aiKey });
    if (timezone !== current.timezone) rescheduleTenant(tid);
    res.json(settingsOut(tid));
  },

  async testAi(req: express.Request, res: express.Response) {
    const cfg = getTenantAiConfig(tenantOf(req));
    if (!cfg) throw conflict('Save an AI provider and API key first');
    try {
      const text = await complete(cfg, { system: 'You are a connectivity check.', prompt: 'Reply with exactly: OK', maxTokens: 200 });
      res.json({ ok: true, provider: cfg.provider, model: cfg.model, reply: text.slice(0, 50) });
    } catch (err) {
      throw aiErrorResponse(err, 'AI request failed');
    }
  },
};

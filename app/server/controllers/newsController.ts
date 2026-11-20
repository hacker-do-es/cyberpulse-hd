import type express from 'express';
import { config } from '../config';
import { getSqlite } from '../db/client';
import type { ArticleRow, SourceRow } from '../db/schema';
import { eventLoopStats } from '../lib/eventLoop';
import { badRequest, conflict, idParam, isUniqueViolation, notFound, tenantOf } from '../lib/http';
import { articleRepository } from '../repositories/articleRepository';
import { fetchLogRepository, sourceRepository } from '../repositories/sourceRepository';
import { getTenantAiConfig } from '../services/ai';
import { generateDailyDigest, generatePost, type GeneratePostRequest } from '../services/postGenerator';
import { generateAiPostText } from '../services/postAi';
import { publishDate, scrapeAll, timeAgo } from '../services/scraper';
import { runScrape, scrapeState } from '../jobs';
import { aiErrorResponse } from './tenantSettingsController';

export function articleOut(row: ArticleRow) {
  return {
    id: String(row.id),
    title: row.title,
    summary: row.summary,
    source: row.source,
    severity: row.severity,
    category: row.category,
    publishedAt: timeAgo(row.publishedAt ?? ''),
    /* publishedAt above is a display string ("2 HRS AGO"); the client needs
       the real instant to sort and filter by date. */
    publishedAtIso: row.publishedAt,
    publishDate: publishDate(row.publishedAt ?? ''),
    readTime: row.readTime,
    url: row.url,
  };
}

function sourceOut(s: SourceRow) {
  return { id: String(s.id), name: s.name, rssUrl: s.rssUrl, category: s.category, active: s.active, custom: s.custom };
}

export const healthController = {
  health(_req: express.Request, res: express.Response) {
    try {
      getSqlite().prepare('SELECT 1').get();
      res.json({ status: 'ok', eventLoopDelay: eventLoopStats() });
    } catch {
      res.status(500).json({ status: 'error' });
    }
  },
};

export const newsController = {
  list(req: express.Request, res: express.Response) {
    /* The UI filters by source client-side, so the default ceiling is high:
       retention keeps 100 per source, which bounds it. */
    const limit = Math.min(parseInt(req.query.limit as string) || 50, config.maxNews);
    const sources = typeof req.query.sources === 'string' ? req.query.sources.split(',') : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const rows = articleRepository.list({ sources, search, limit }).map(articleOut);
    res.json({ articles: rows, count: rows.length });
  },

  get(req: express.Request, res: express.Response) {
    const row = articleRepository.findById(idParam(req));
    if (!row) throw notFound('Article not found');
    res.json(articleOut(row));
  },

  stats(_req: express.Request, res: express.Response) {
    res.json({
      totalArticles: articleRepository.count(),
      totalSources: sourceRepository.countActive(),
      lastFetch: fetchLogRepository.lastFetch(),
      recentFetches: fetchLogRepository.recent(10),
    });
  },
};

export const sourceController = {
  list(_req: express.Request, res: express.Response) {
    res.json({
      sources: sourceRepository.listAll().map((s) => ({
        id: String(s.id), name: s.name, category: s.category, active: s.active,
        custom: s.custom, count: s.articleCount, lastFetch: s.lastFetch,
      })),
    });
  },

  create(req: express.Request, res: express.Response) {
    const { name, rssUrl, category } = req.body ?? {};
    const valid = (v: unknown) => typeof v === 'string' && v.trim() !== '';
    if (!valid(name) || !valid(rssUrl) || !valid(category)) throw badRequest('name, rssUrl, and category are required');
    try {
      res.status(201).json({ source: sourceOut(sourceRepository.createCustom(name.trim(), rssUrl.trim(), category.trim())) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Source already exists');
      throw err;
    }
  },

  remove(req: express.Request, res: express.Response) {
    if (!sourceRepository.deleteCustom(idParam(req))) throw notFound('Source not found or not removable');
    res.json({ success: true });
  },

  setActive(req: express.Request, res: express.Response) {
    const { active } = req.body ?? {};
    if (typeof active !== 'boolean') throw badRequest('active must be a boolean');
    const row = sourceRepository.setActive(idParam(req), active);
    if (!row) throw notFound('Source not found');
    res.json({ source: sourceOut(row) });
  },
};

export const scrapeController = {
  status(_req: express.Request, res: express.Response) {
    res.json({
      scraping: scrapeState.running,
      startedAt: scrapeState.startedAt,
      lastFetch: fetchLogRepository.lastFetch(),
      lastResult: scrapeState.lastResult,
    });
  },

  /* Starts in the background and answers immediately. */
  start(_req: express.Request, res: express.Response) {
    runScrape().catch((err) => console.error('[SCRAPER] Failed to start scrape:', err));
    res.json({ success: true, message: 'Scraping started' });
  },
};

export const generateController = {
  template(req: express.Request, res: express.Response) {
    const body = req.body as GeneratePostRequest;
    if (!body?.articleId || !body.title || !body.summary) throw badRequest('Missing required fields: articleId, title, summary');
    res.json(generatePost(body));
  },

  digest(req: express.Request, res: express.Response) {
    const { articles, tone, length, language } = req.body ?? {};
    if (!Array.isArray(articles) || articles.length === 0) throw badRequest('Missing or invalid articles array');
    res.json(generateDailyDigest(articles, tone || 'Professional', length || 'medium', language || 'en'));
  },

  /* AI post with the company's own provider and key. */
  async ai(req: express.Request, res: express.Response) {
    const { title, summary, source, category, severity, url, tone, format, length, language } = req.body ?? {};
    if (typeof title !== 'string' || typeof url !== 'string') throw badRequest('title and url are required');
    const cfg = getTenantAiConfig(tenantOf(req));
    if (!cfg) throw conflict('No AI provider configured for this company. An admin can add a Claude or OpenAI key in Settings.');
    const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

    try {
      const post = await generateAiPostText(cfg, {
        title, summary: clip(summary, 3000), source: clip(source, 200), category: clip(category, 100), severity: clip(severity, 20), url,
      }, { tone: clip(tone, 40), format: clip(format, 40), length: clip(length, 20), language });
      res.json({ post });
    } catch (err) {
      throw aiErrorResponse(err, 'AI generation failed');
    }
  },
};

/* Read-only machine API for AI agents (X-API-Key). */
export const mcpController = {
  async handle(req: express.Request, res: express.Response) {
    const { action, params } = req.body ?? {};
    switch (action) {
      case 'list_news': {
        const limit = Math.min(Number(params?.limit) || 10, 200);
        return res.json({
          result: articleRepository.latestFetched(limit).map((r) => ({
            id: String(r.id), title: r.title, source: r.source, severity: r.severity,
            publishedAt: timeAgo(r.publishedAt ?? ''), url: r.url,
          })),
        });
      }
      case 'get_article': {
        const r = articleRepository.findById(Number(params?.id));
        return res.json({
          result: r
            ? { id: String(r.id), title: r.title, summary: r.summary, source: r.source, severity: r.severity, publishedAt: timeAgo(r.publishedAt ?? ''), url: r.url }
            : null,
        });
      }
      case 'generate_post':
        return res.json({ result: generatePost(params as GeneratePostRequest) });
      case 'generate_digest': {
        const { articles, tone, length, language } = params ?? {};
        return res.json({ result: generateDailyDigest(articles, tone, length, language) });
      }
      case 'scrape':
        return res.json({ result: await scrapeAll() });
      case 'list_sources':
        return res.json({
          result: sourceRepository.listAll().map((s) => ({ id: String(s.id), name: s.name, category: s.category, active: s.active })),
        });
      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          available_actions: ['list_news', 'get_article', 'generate_post', 'generate_digest', 'scrape', 'list_sources'],
        });
    }
  },
};

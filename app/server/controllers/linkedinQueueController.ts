import type express from 'express';
import type { LinkedinQueueRow, LinkedinQueueStatus } from '../db/schema';
import { LINKEDIN_QUEUE_STATUSES } from '../db/schema';
import { badRequest, conflict, forbidden, idParam, notFound, tenantOf } from '../lib/http';
import { linkedinQueueRepository } from '../repositories/linkedinQueueRepository';
import { userRepository } from '../repositories/userRepository';
import { channelRepository } from '../repositories/channelRepository';
import { PublishError, resolveAuthor } from '../services/linkedin/accounts';
import { postUrl } from '../services/linkedin/client';
import { MAX_POST_CHARS } from '../services/linkedin/text';
import { toSqlUtc } from '../services/schedule';
import { publishDuePosts } from '../services/linkedin/queueWorker';
import { publishHttpError } from './linkedinController';
import { can } from '../shared/permissions';

/* The LinkedIn publishing queue of a company: posts from LinkedIn channels
   waiting for approval, posts scheduled by hand, and their outcome.
   Approvers (company admins) see and decide on everything; operators see and
   manage their own. */

const isAdmin = (req: express.Request) => can(req.auth!.user.role, 'linkedin.approve');
const MAX_AHEAD_MS = 90 * 86_400_000;

function canManage(req: express.Request, row: LinkedinQueueRow): boolean {
  return isAdmin(req) || row.createdBy === req.auth!.user.id || row.authorUserId === req.auth!.user.id;
}

function rowOut(row: LinkedinQueueRow, names: Map<number, string>, channels: Map<number, string>) {
  let articles: Array<{ id: number; title: string; url: string }> = [];
  try { articles = row.articles ? JSON.parse(row.articles) : []; } catch { /* ignore */ }
  return {
    id: row.id,
    status: row.status,
    text: row.text,
    author: row.author,
    authorLabel: row.authorLabel,
    authorUser: names.get(row.authorUserId) ?? null,
    channel: row.channelId ? { id: row.channelId, name: channels.get(row.channelId) ?? null } : null,
    createdBy: row.createdBy ? names.get(row.createdBy) ?? null : null,
    articles,
    scheduledFor: row.scheduledFor,
    decidedBy: row.decidedBy ? names.get(row.decidedBy) ?? null : null,
    decidedAt: row.decidedAt,
    publishedAt: row.publishedAt,
    url: row.postUrn ? postUrl(row.postUrn) : null,
    error: row.error,
    createdAt: row.createdAt,
  };
}

function out(req: express.Request, rows: LinkedinQueueRow[]) {
  const tid = tenantOf(req);
  const names = new Map(userRepository.listByTenant(tid).map((u) => [u.id, u.displayName || u.username] as [number, string]));
  const me = req.auth!.user;
  if (!names.has(me.id)) names.set(me.id, me.displayName || me.username);
  const channels = new Map(channelRepository.listByTenant(tid).map((c) => [c.id, c.name] as [number, string]));
  return rows.map((r) => rowOut(r, names, channels));
}

/* 'YYYY-MM-DDTHH:MM(:SS)(.sss)Z' or with offset → UTC SQL; must be in the future (≤ 90 days). */
function parseWhen(v: unknown): string {
  if (typeof v !== 'string' || !v) throw badRequest('Pick a date and time');
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest('Invalid date');
  if (d.getTime() < Date.now() - 60_000) throw badRequest('That time is in the past');
  if (d.getTime() > Date.now() + MAX_AHEAD_MS) throw badRequest('Posts can be scheduled at most 90 days ahead');
  return toSqlUtc(d);
}

function cleanText(v: unknown): string {
  const t = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '';
  if (!t) throw badRequest('The post is empty');
  if (t.length > MAX_POST_CHARS) throw badRequest(`LinkedIn posts can have at most ${MAX_POST_CHARS} characters`);
  return t;
}

function rowOf(req: express.Request): LinkedinQueueRow {
  const row = linkedinQueueRepository.findInTenant(idParam(req), tenantOf(req));
  if (!row || !canManage(req, row)) throw notFound('Post not found');
  return row;
}

export const linkedinQueueController = {
  list(req: express.Request, res: express.Response) {
    const raw = typeof req.query.status === 'string' ? req.query.status.split(',') : [];
    const statuses = raw.filter((s): s is LinkedinQueueStatus => (LINKEDIN_QUEUE_STATUSES as readonly string[]).includes(s));
    let rows = linkedinQueueRepository.listByTenant(tenantOf(req), statuses.length ? statuses : null);
    if (!isAdmin(req)) rows = rows.filter((r) => canManage(req, r));
    res.json({ posts: out(req, rows), canApprove: isAdmin(req) });
  },

  /* Generate Post → "Schedule": publish this text at that time as that author. */
  schedule(req: express.Request, res: express.Response) {
    const user = req.auth!.user;
    const text = cleanText(req.body?.text);
    const author = typeof req.body?.author === 'string' ? req.body.author : 'member';
    const when = parseWhen(req.body?.scheduledFor);
    let label: string;
    try {
      label = resolveAuthor(user.id, author).label;
    } catch (err) {
      throw publishHttpError(err);
    }
    const row = linkedinQueueRepository.create({
      tenantId: tenantOf(req), channelId: null, createdBy: user.id, authorUserId: user.id,
      author, authorLabel: label, text, articles: null, status: 'scheduled', scheduledFor: when,
      decidedBy: user.id, decidedAt: toSqlUtc(new Date()),
    });
    res.status(201).json({ post: out(req, [row])[0] });
  },

  /* Edit the text or the time of a post that has not gone out yet. */
  update(req: express.Request, res: express.Response) {
    const row = rowOf(req);
    if (row.status !== 'pending' && row.status !== 'scheduled') throw conflict('This post can no longer be changed');
    const v: { text?: string; scheduledFor?: string } = {};
    if (req.body?.text !== undefined) v.text = cleanText(req.body.text);
    if (req.body?.scheduledFor !== undefined) {
      if (row.status !== 'scheduled') throw badRequest('Approve the post to set its time');
      v.scheduledFor = parseWhen(req.body.scheduledFor);
    }
    if (!linkedinQueueRepository.transition(row.id, [row.status], { status: row.status, ...v })) throw conflict('The post changed meanwhile; reload');
    res.json({ post: out(req, [linkedinQueueRepository.find(row.id)!])[0] });
  },

  /* Admins: approve a pending post, now or for a time (optionally with edited text). */
  async approve(req: express.Request, res: express.Response) {
    if (!isAdmin(req)) throw forbidden('Only company admins can approve posts');
    const row = rowOf(req);
    if (row.status !== 'pending') throw conflict('Only posts waiting for approval can be approved');
    const nowSql = toSqlUtc(new Date());
    const when = req.body?.scheduledFor ? parseWhen(req.body.scheduledFor) : nowSql;
    const text = req.body?.text !== undefined ? cleanText(req.body.text) : row.text;
    try {
      resolveAuthor(row.authorUserId, row.author);
    } catch (err) {
      if (err instanceof PublishError) throw conflict(`Cannot publish yet: ${err.message} (the LinkedIn connection belongs to ${row.authorLabel ?? 'the channel owner'})`);
      throw err;
    }
    if (!linkedinQueueRepository.transition(row.id, ['pending'], { status: 'scheduled', text, scheduledFor: when, decidedBy: req.auth!.user.id, decidedAt: nowSql })) {
      throw conflict('The post changed meanwhile; reload');
    }
    /* "Approve now" should not wait for the next minute tick. */
    if (when <= nowSql) await publishDuePosts();
    res.json({ post: out(req, [linkedinQueueRepository.find(row.id)!])[0] });
  },

  reject(req: express.Request, res: express.Response) {
    if (!isAdmin(req)) throw forbidden('Only company admins can reject posts');
    const row = rowOf(req);
    if (!linkedinQueueRepository.transition(row.id, ['pending'], { status: 'rejected', decidedBy: req.auth!.user.id, decidedAt: toSqlUtc(new Date()) })) {
      throw conflict('Only posts waiting for approval can be rejected');
    }
    res.json({ post: out(req, [linkedinQueueRepository.find(row.id)!])[0] });
  },

  cancel(req: express.Request, res: express.Response) {
    const row = rowOf(req);
    if (!linkedinQueueRepository.transition(row.id, ['pending', 'scheduled'], { status: 'cancelled', decidedBy: req.auth!.user.id, decidedAt: toSqlUtc(new Date()) })) {
      throw conflict('Only posts that have not gone out can be cancelled');
    }
    res.json({ post: out(req, [linkedinQueueRepository.find(row.id)!])[0] });
  },
};

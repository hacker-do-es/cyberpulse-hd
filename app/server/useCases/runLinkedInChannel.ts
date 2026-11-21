import type { ChannelRow, TenantRow } from '../db/schema';
import { channelRepository } from '../repositories/channelRepository';
import { linkedinQueueRepository } from '../repositories/linkedinQueueRepository';
import { selectCandidates } from '../services/digest';
import { PublishError, publishAs, resolveAuthor } from '../services/linkedin/accounts';
import { composePosts, isFormat, isLength, isTone } from '../services/linkedin/compose';
import { audit } from '../services/logs/logStore';
import { toSqlUtc } from '../services/schedule';
import { tenantStack } from '../services/stackNews';
import type { RunResult } from './runChannelDigest';

/* One run of a LinkedIn channel: pick new stack-matched stories, write up to
   posts-per-run posts (never above the daily limit), then publish them with
   the channel owner's LinkedIn connection, or leave them for approval. */

export const LINKEDIN_DEFAULTS = { postsPerRun: 1, maxPostsPerDay: 2 };
const DAY_MS = 86_400_000;

function articlesJson(items: Array<{ id: number; title: string; url: string }>): string {
  return JSON.stringify(items.map((a) => ({ id: a.id, title: a.title.slice(0, 300), url: a.url })));
}

export async function runLinkedInChannel(channel: ChannelRow, tenant: TenantRow, now: Date): Promise<RunResult> {
  const owner = channel.liUserId;
  const wanted = channel.liAuthor || 'member';
  if (!owner) return { status: 'error', articleCount: 0, detail: 'The user who set up this LinkedIn channel no longer exists. Edit the channel to take it over.' };

  /* Check the connection before spending AI calls or articles. */
  let label: string;
  try {
    label = resolveAuthor(owner, wanted).label;
  } catch (err) {
    const msg = err instanceof PublishError ? err.message : 'LinkedIn connection problem';
    if (err instanceof PublishError && err.code === 'reconnect') {
      /* Pause until someone reconnects: otherwise every run fails the same way. */
      channelRepository.update(channel.id, channel.tenantId, { active: false });
      audit({ action: 'channel.paused', detail: `id=${channel.id} LinkedIn connection expired`, level: 'warn', userId: owner, tenantId: channel.tenantId });
      return { status: 'error', articleCount: 0, detail: `${msg} The channel was paused; reconnect LinkedIn and turn it back on.` };
    }
    return { status: 'error', articleCount: 0, detail: msg };
  }

  const stack = tenantStack(tenant.id);
  if (stack.length === 0) return { status: 'skipped', articleCount: 0, detail: 'The company has no technology stack configured' };

  const maxPerDay = channel.maxPostsPerDay ?? LINKEDIN_DEFAULTS.maxPostsPerDay;
  const used = linkedinQueueRepository.countForChannelSince(channel.id, toSqlUtc(new Date(now.getTime() - DAY_MS)));
  const remaining = maxPerDay - used;
  if (remaining <= 0) return { status: 'skipped', articleCount: 0, detail: `Daily limit reached (${used}/${maxPerDay} in the last 24 h)` };

  /* No asset links are passed, and any `assets` field is dropped anyway:
     client asset names must never reach a LinkedIn post or the AI writing it. */
  const items = (await selectCandidates(channel, stack, now)).map((c) => ({ ...c, assets: undefined }));
  if (items.length === 0) return { status: 'skipped', articleCount: 0, detail: 'No new news matching the stack' };

  const perRun = Math.min(channel.postsPerRun ?? LINKEDIN_DEFAULTS.postsPerRun, remaining);
  const { posts, note } = await composePosts(tenant.id, items, perRun, {
    format: isFormat(channel.postFormat) ? channel.postFormat : 'News Analysis',
    tone: isTone(channel.postTone) ? channel.postTone : 'Professional',
    length: isLength(channel.postLength) ? channel.postLength : 'medium',
    language: channel.postLanguage === 'en' ? 'en' : channel.postLanguage === 'es' ? 'es' : (tenant.language === 'en' ? 'en' : 'es'),
    useAi: channel.useAi,
  });

  const nowSql = toSqlUtc(now);
  const approval = channel.requireApproval ?? wanted !== 'member';
  let queued = 0;
  let published = 0;
  const errors: string[] = [];
  const usedArticles = new Set<number>();

  for (const p of posts) {
    p.articles.forEach((a) => usedArticles.add(a.id));
    const base = {
      tenantId: channel.tenantId, channelId: channel.id, createdBy: null, authorUserId: owner,
      author: wanted, authorLabel: label, text: p.text, articles: articlesJson(p.articles),
    };
    if (approval) {
      linkedinQueueRepository.create({ ...base, status: 'pending' });
      queued++;
      continue;
    }
    const row = linkedinQueueRepository.create({ ...base, status: 'publishing', scheduledFor: nowSql, decidedAt: nowSql });
    try {
      const r = await publishAs(owner, channel.tenantId, wanted, p.text);
      linkedinQueueRepository.update(row.id, { status: 'published', postUrn: r.urn, publishedAt: toSqlUtc(new Date()) });
      published++;
    } catch (err) {
      const msg = err instanceof PublishError ? err.message : 'LinkedIn request failed';
      linkedinQueueRepository.update(row.id, { status: 'failed', error: msg.slice(0, 500) });
      errors.push(msg);
      if (err instanceof PublishError && err.code === 'reconnect') break;
    }
  }

  /* Stories used in a post (queued or published) are not offered again. */
  if (usedArticles.size) channelRepository.markSent(channel.id, [...usedArticles], nowSql);

  if (published === 0 && queued === 0) {
    return { status: 'error', articleCount: usedArticles.size, detail: errors[0] ?? 'Nothing was published' };
  }
  const parts: string[] = [];
  if (published) parts.push(`Published ${published} post${published === 1 ? '' : 's'} on LinkedIn as ${label}`);
  if (queued) parts.push(`${queued} post${queued === 1 ? '' : 's'} waiting for approval`);
  if (errors.length) parts.push(`${errors.length} failed: ${errors[0]}`);
  return { status: 'sent', articleCount: usedArticles.size, detail: parts.join('; ') + note };
}

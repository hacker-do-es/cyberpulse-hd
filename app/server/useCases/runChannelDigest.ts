import type { ChannelRow, TenantRow } from '../db/schema';
import { decryptSecret } from '../lib/crypto';
import { channelRepository, deliveryRepository } from '../repositories/channelRepository';
import { tenantRepository } from '../repositories/tenantRepository';
import { AiError } from '../services/ai';
import { aiSummary, digestEmail, digestText, emptyStats, isVerifiedOnly, selectCandidates, testEmail, testText, withAssets } from '../services/digest';
import { assetRepository } from '../repositories/assetRepository';
import { MailError, sendEmail, summarizeReport } from '../services/mail/send';
import { parseStoredTarget } from '../services/mail/target';
import { toSqlUtc } from '../services/schedule';
import { tenantStack } from '../services/stackNews';
import { deliver } from '../services/webhooks';
import { resolveAuthor, PublishError } from '../services/linkedin/accounts';
import { runLinkedInChannel } from './runLinkedInChannel';

/* Builds one company's digest for one channel, sends it and records the
   outcome. Used by the scheduler and by the "Send now" button. */

export interface RunResult {
  status: 'sent' | 'skipped' | 'error';
  articleCount: number;
  detail: string;
}

const running = new Set<number>();

export async function runChannelDigest(channelId: number, trigger: 'schedule' | 'manual'): Promise<RunResult> {
  if (running.has(channelId)) return { status: 'skipped', articleCount: 0, detail: 'Already running' };
  running.add(channelId);
  try {
    const channel = channelRepository.findById(channelId);
    if (!channel) return { status: 'error', articleCount: 0, detail: 'Channel not found' };
    const tenant = tenantRepository.findById(channel.tenantId);
    if (!tenant) return { status: 'error', articleCount: 0, detail: 'Company not found' };

    const now = new Date();
    const result = await buildAndSend(channel, tenant, now);

    channelRepository.setLastRun(channel.id, toSqlUtc(now));
    deliveryRepository.record({ channelId: channel.id, tenantId: channel.tenantId, trigger, ...result });
    return result;
  } finally {
    running.delete(channelId);
  }
}

async function buildAndSend(channel: ChannelRow, tenant: TenantRow, now: Date): Promise<RunResult> {
  if (channel.type === 'linkedin') return runLinkedInChannel(channel, tenant, now);
  const stack = tenantStack(tenant.id);
  if (stack.length === 0) {
    return { status: 'skipped', articleCount: 0, detail: 'The company has no technology stack configured' };
  }

  /* Assets are looked up only for channels that use them (LinkedIn returned
     above and never sees them). */
  const assetLinks = channel.includeAssets || channel.minAssetCriticality ? assetRepository.linksByStackItem(tenant.id) : undefined;
  const stats = emptyStats();
  const selected = await selectCandidates(channel, stack, now, assetLinks, stats);
  if (selected.length === 0) {
    if (isVerifiedOnly(channel) && stats.matched > 0) {
      return {
        status: 'skipped',
        articleCount: 0,
        detail: `No confirmed vulnerabilities for the installed versions (${stats.matched} matching news: ${stats.notAffected} not affected, ${stats.unverified} unverified, ${stats.noCve} without CVE)`,
      };
    }
    return { status: 'skipped', articleCount: 0, detail: 'No new news matching the stack' };
  }
  /* The AI summary below is given `selected`, which never carries assets:
     client asset names are not sent to the AI provider. */
  const items = channel.includeAssets && assetLinks ? withAssets(selected, assetLinks) : selected;

  let summary: string | null = null;
  let aiNote = '';
  if (channel.useAi) {
    try {
      summary = await aiSummary(tenant.id, tenant.language, selected);
    } catch (err) {
      /* A broken AI key must not stop the alerts themselves. */
      aiNote = ` (AI summary skipped: ${err instanceof AiError ? err.message : 'error'})`;
    }
  }

  let deliveredTo = '';
  try {
    if (channel.type === 'email') {
      const report = await sendEmail(parseStoredTarget(decryptSecret(channel.webhookUrl)), digestEmail(channel, tenant, items, summary));
      /* Nobody got it: retry these articles next time. */
      if (report.sent.length === 0) return { status: 'error', articleCount: items.length, detail: summarizeReport(report) };
      deliveredTo = ` to ${summarizeReport(report)}`;
    } else {
      await deliver(channel.type, decryptSecret(channel.webhookUrl), digestText(channel, tenant, items, summary));
    }
  } catch (err: any) {
    return { status: 'error', articleCount: items.length, detail: String(err?.message || err) };
  }

  channelRepository.markSent(channel.id, items.map((i) => i.id), toSqlUtc(now));
  return { status: 'sent', articleCount: items.length, detail: `Delivered ${items.length} articles${deliveredTo}${aiNote}` };
}

export async function sendChannelTest(channel: ChannelRow): Promise<void> {
  /* LinkedIn: never publish a test post; just check the connection works. */
  if (channel.type === 'linkedin') {
    if (!channel.liUserId) throw new PublishError('The user who set up this LinkedIn channel no longer exists', 'invalid');
    resolveAuthor(channel.liUserId, channel.liAuthor || 'member');
    return;
  }
  const tenant = tenantRepository.findById(channel.tenantId);
  if (channel.type === 'email') {
    const report = await sendEmail(parseStoredTarget(decryptSecret(channel.webhookUrl)), testEmail(channel, tenant));
    if (report.failed.length) throw new MailError(summarizeReport(report));
    return;
  }
  await deliver(channel.type, decryptSecret(channel.webhookUrl), testText(channel, tenant));
}

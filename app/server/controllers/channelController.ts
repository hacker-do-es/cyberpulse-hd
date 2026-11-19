import type express from 'express';
import type { ChannelRow, ChannelType } from '../db/schema';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest, conflict, idParam, notFound, str, tenantOf } from '../lib/http';
import { channelRepository, deliveryRepository, type ChannelValues } from '../repositories/channelRepository';
import { rescheduleChannel } from '../services/channelSchedule';
import { SEVERITIES } from '../services/digest';
import { parseWeekdays, validateSchedule, type Schedule } from '../services/schedule';
import { WebhookError, validateWebhookUrl } from '../services/webhooks';
import { runChannelDigest, sendChannelTest } from '../useCases/runChannelDigest';

export const MAX_HEADER_LENGTH = 150;
export const MAX_FOOTER_LENGTH = 300;
const MAX_CHANNELS_PER_TENANT = 20;

function channelOut(row: ChannelRow) {
  const url = decryptSecret(row.webhookUrl);
  let host = '';
  try {
    host = new URL(url).host;
  } catch { /* not a URL */ }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    webhookHint: host ? `${host}/…${url.slice(-4)}` : '',
    active: row.active,
    schedule: {
      type: row.scheduleType,
      intervalHours: row.intervalHours,
      timeOfDay: row.timeOfDay,
      weekdays: parseWeekdays(row.weekdays),
    },
    minSeverity: row.minSeverity,
    maxItems: row.maxItems,
    useAi: row.useAi,
    header: row.headerText,
    footer: row.footerText,
    lastRunAt: row.lastRunAt,
    lastSentAt: row.lastSentAt,
    nextRunAt: row.nextRunAt,
  };
}

/* header: null/'' = default. footer: null = default, '' = none. */
function parseBranding(body: any, existing?: ChannelRow): { headerText: string | null; footerText: string | null } {
  let headerText = existing?.headerText ?? null;
  if (body?.header !== undefined) {
    if (body.header !== null && typeof body.header !== 'string') throw badRequest('header must be text');
    const h = (body.header ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (h.length > MAX_HEADER_LENGTH) throw badRequest(`Header can be at most ${MAX_HEADER_LENGTH} characters`);
    headerText = h || null;
  }
  let footerText = existing ? existing.footerText : null;
  if (body?.footer !== undefined) {
    if (body.footer !== null && typeof body.footer !== 'string') throw badRequest('footer must be text');
    if (body.footer === null) footerText = null;
    else {
      const lines = body.footer.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length > 3) throw badRequest('Footer can have at most 3 lines');
      const f = lines.join('\n');
      if (f.length > MAX_FOOTER_LENGTH) throw badRequest(`Footer can be at most ${MAX_FOOTER_LENGTH} characters`);
      footerText = f;
    }
  }
  return { headerText, footerText };
}

/* Full validation of a create (no `existing`) or a partial update. The
   webhook URL is only returned when a new one was sent. */
function parseChannelInput(body: any, existing?: ChannelRow): Omit<ChannelValues, 'webhookUrl'> & { webhookUrl?: string } {
  const name = str(body?.name, 80) ?? existing?.name;
  if (!name) throw badRequest('Name is required (max 80 characters)');
  const type = (body?.type ?? existing?.type) as ChannelType;
  if (type !== 'slack' && type !== 'rocketchat') throw badRequest('type must be "slack" or "rocketchat"');

  let webhookUrl: string | undefined;
  if (body?.webhookUrl !== undefined && body.webhookUrl !== '') {
    const v = validateWebhookUrl(type, body.webhookUrl);
    if ('error' in v) throw badRequest(v.error);
    webhookUrl = v.url.toString();
  } else if (!existing) {
    throw badRequest('Webhook URL is required');
  } else if (type !== existing.type) {
    throw badRequest('Changing the channel type needs a new webhook URL');
  }

  const s = body?.schedule ?? (existing ? {
    type: existing.scheduleType, intervalHours: existing.intervalHours,
    timeOfDay: existing.timeOfDay, weekdays: parseWeekdays(existing.weekdays),
  } : undefined);
  if (!s) throw badRequest('schedule is required');
  const schedule: Schedule = {
    type: s.type,
    intervalHours: s.type === 'interval' ? Number(s.intervalHours) : null,
    timeOfDay: s.type === 'weekly' ? s.timeOfDay : null,
    weekdays: s.type === 'weekly' && Array.isArray(s.weekdays) ? [...new Set<number>(s.weekdays.map(Number))].sort() : null,
  };
  const schedErr = validateSchedule(schedule);
  if (schedErr) throw badRequest(schedErr);

  const minSeverity = body?.minSeverity ?? existing?.minSeverity ?? 'medium';
  if (!(SEVERITIES as readonly string[]).includes(minSeverity)) throw badRequest('Unknown severity');
  const maxItems = Number(body?.maxItems ?? existing?.maxItems ?? 15);
  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > 50) throw badRequest('maxItems must be 1-50');

  return {
    name,
    type,
    webhookUrl,
    scheduleType: schedule.type,
    intervalHours: schedule.intervalHours,
    timeOfDay: schedule.timeOfDay,
    weekdays: schedule.weekdays?.join(',') ?? null,
    minSeverity,
    maxItems,
    ...parseBranding(body, existing),
    active: body?.active === undefined ? (existing ? existing.active : true) : Boolean(body.active),
    useAi: body?.useAi === undefined ? (existing ? existing.useAi : true) : Boolean(body.useAi),
  };
}

function channelOf(req: express.Request): ChannelRow {
  const channel = channelRepository.findInTenant(idParam(req), tenantOf(req));
  if (!channel) throw notFound('Channel not found');
  return channel;
}

export const channelController = {
  list(req: express.Request, res: express.Response) {
    res.json({ channels: channelRepository.listByTenant(tenantOf(req)).map(channelOut) });
  },

  create(req: express.Request, res: express.Response) {
    const tid = tenantOf(req);
    const v = parseChannelInput(req.body);
    if (channelRepository.count(tid) >= MAX_CHANNELS_PER_TENANT) {
      throw conflict(`A company can have at most ${MAX_CHANNELS_PER_TENANT} channels`);
    }
    const row = channelRepository.create(tid, { ...v, webhookUrl: encryptSecret(v.webhookUrl!) });
    rescheduleChannel(row.id);
    res.status(201).json({ channel: channelOut(channelRepository.findById(row.id)!) });
  },

  update(req: express.Request, res: express.Response) {
    const existing = channelOf(req);
    const v = parseChannelInput(req.body, existing);
    channelRepository.update(existing.id, existing.tenantId, {
      ...v,
      webhookUrl: v.webhookUrl ? encryptSecret(v.webhookUrl) : existing.webhookUrl,
    });
    rescheduleChannel(existing.id);
    res.json({ channel: channelOut(channelRepository.findById(existing.id)!) });
  },

  remove(req: express.Request, res: express.Response) {
    if (!channelRepository.delete(idParam(req), tenantOf(req))) throw notFound('Channel not found');
    res.json({ success: true });
  },

  async test(req: express.Request, res: express.Response) {
    const channel = channelOf(req);
    try {
      await sendChannelTest(channel);
    } catch (err) {
      throw new HttpError(502, err instanceof WebhookError ? err.message : 'Webhook request failed');
    }
    res.json({ ok: true });
  },

  async run(req: express.Request, res: express.Response) {
    const channel = channelOf(req);
    const result = await runChannelDigest(channel.id, 'manual');
    res.status(result.status === 'error' ? 502 : 200).json(result);
  },

  deliveries(req: express.Request, res: express.Response) {
    res.json({ deliveries: deliveryRepository.listForChannel(channelOf(req).id) });
  },
};

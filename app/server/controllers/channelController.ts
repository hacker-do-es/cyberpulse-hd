import type express from 'express';
import type { ChannelRow, ChannelType } from '../db/schema';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { HttpError, badRequest, conflict, idParam, notFound, str, tenantOf } from '../lib/http';
import { channelRepository, deliveryRepository, type ChannelValues } from '../repositories/channelRepository';
import { rescheduleChannel } from '../services/channelSchedule';
import { SEVERITIES } from '../services/digest';
import { parseWeekdays, validateSchedule, type Schedule } from '../services/schedule';
import { WebhookError, validateWebhookUrl } from '../services/webhooks';
import { MAX_HTML_LENGTH, sanitizeEmailHtml } from '../services/mail/html';
import { MailError } from '../services/mail/send';
import { parseRecipients, parseSmtp, parseStoredTarget, publicTarget, serializeTarget, type EmailTarget } from '../services/mail/target';
import { previewEmail } from '../services/digest';
import { parseStoredTelegramTarget, parseTelegramTarget, publicTelegramTarget, serializeTelegramTarget, type TelegramTarget } from '../services/webhooks/telegram';
import { tenantRepository } from '../repositories/tenantRepository';
import { runChannelDigest, sendChannelTest } from '../useCases/runChannelDigest';
import { LINKEDIN_DEFAULTS } from '../useCases/runLinkedInChannel';
import { PublishError, resolveAuthor } from '../services/linkedin/accounts';
import { isFormat, isLength, isTone } from '../services/linkedin/compose';
import { userRepository } from '../repositories/userRepository';

export const MAX_HEADER_LENGTH = 150;
export const MAX_FOOTER_LENGTH = 300;
const MAX_CHANNELS_PER_TENANT = 20;
/* Channel types that deliver news digests. */
const DIGEST_TYPES = ['slack', 'rocketchat', 'discord', 'telegram', 'email', 'linkedin'] as const;

function storedTarget(row: ChannelRow): EmailTarget | null {
  if (row.type !== 'email') return null;
  try {
    return parseStoredTarget(decryptSecret(row.webhookUrl));
  } catch {
    return null;
  }
}

function storedTelegram(row: ChannelRow): TelegramTarget | null {
  if (row.type !== 'telegram') return null;
  try {
    return parseStoredTelegramTarget(decryptSecret(row.webhookUrl));
  } catch {
    return null;
  }
}

function channelOut(row: ChannelRow) {
  const target = storedTarget(row);
  const tg = storedTelegram(row);
  let hint = '';
  if (target) {
    hint = `${target.recipients.length} recipient${target.recipients.length === 1 ? '' : 's'} · ${target.smtp.host}:${target.smtp.port}`;
  } else if (tg) {
    hint = `chat ${tg.chatId} · bot ${tg.botToken.split(':')[0]}`;
  } else if (row.type === 'linkedin') {
    hint = row.liAuthor === 'member' ? 'LinkedIn profile' : `LinkedIn Page ${row.liAuthor?.replace('urn:li:organization:', '#') ?? ''}`;
  } else if (row.type !== 'email' && row.type !== 'telegram') {
    const url = decryptSecret(row.webhookUrl);
    try {
      hint = `${new URL(url).host}/…${url.slice(-4)}`;
    } catch { /* not a URL */ }
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    webhookHint: hint,
    /* Email channels: recipients and SMTP settings, never the password. */
    email: target ? publicTarget(target) : null,
    /* Telegram channels: chat and bot id, never the token. */
    telegram: tg ? publicTelegramTarget(tg) : null,
    linkedin: row.type === 'linkedin' ? {
      author: row.liAuthor,
      owner: row.liUserId ? (() => { const u = userRepository.findById(row.liUserId!); return u ? { id: u.id, name: u.displayName || u.username } : null; })() : null,
      format: row.postFormat, tone: row.postTone, length: row.postLength, language: row.postLanguage,
      postsPerRun: row.postsPerRun, maxPostsPerDay: row.maxPostsPerDay, requireApproval: row.requireApproval,
    } : null,
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
    headerHtml: row.headerHtml,
    footerHtml: row.footerHtml,
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

/* Email header/footer HTML. header: null/'' = default. footer: null =
   default, '' = none. Stored already sanitised. */
function parseHtmlBranding(body: any, existing?: ChannelRow): { headerHtml: string | null; footerHtml: string | null } {
  const one = (v: unknown, field: string): string => {
    if (typeof v !== 'string') throw badRequest(`${field} must be HTML text`);
    if (v.length > MAX_HTML_LENGTH) throw badRequest(`${field} can be at most ${MAX_HTML_LENGTH} characters`);
    return sanitizeEmailHtml(v);
  };
  let headerHtml = existing?.headerHtml ?? null;
  if (body?.headerHtml !== undefined) headerHtml = body.headerHtml === null ? null : one(body.headerHtml, 'Header HTML') || null;
  let footerHtml = existing ? existing.footerHtml : null;
  if (body?.footerHtml !== undefined) footerHtml = body.footerHtml === null ? null : one(body.footerHtml, 'Footer HTML');
  return { headerHtml, footerHtml };
}

/* Recipients + SMTP for an email channel; partial updates keep the rest
   (and the stored password) from the existing channel. */
function parseEmailTarget(body: any, existing?: ChannelRow): string | undefined {
  const prev = existing && existing.type === 'email' ? storedTarget(existing) : null;
  if (body?.recipients === undefined && body?.smtp === undefined) {
    if (prev) return undefined;
    throw badRequest('Recipients and SMTP settings are required');
  }
  const recipients = body?.recipients !== undefined ? parseRecipients(body.recipients) : prev?.recipients;
  if (!recipients) throw badRequest('Add at least one recipient');
  const smtp = parseSmtp(body?.smtp, prev?.smtp);
  return serializeTarget({ recipients, smtp });
}

/* Full validation of a create (no `existing`) or a partial update. The
   webhook URL is only returned when a new one was sent. */
function parseChannelInput(body: any, existing?: ChannelRow, userId?: number): Omit<ChannelValues, 'webhookUrl'> & { webhookUrl?: string } {
  const name = str(body?.name, 80) ?? existing?.name;
  if (!name) throw badRequest('Name is required (max 80 characters)');
  const type = (body?.type ?? existing?.type) as ChannelType;
  if (!(DIGEST_TYPES as readonly string[]).includes(type)) {
    throw badRequest('type must be "slack", "rocketchat", "discord", "telegram", "email" or "linkedin"');
  }

  let webhookUrl: string | undefined;
  if (type === 'email') {
    webhookUrl = parseEmailTarget(body, existing);
  } else if (type === 'linkedin') {
    /* No external target: the channel posts with its owner's LinkedIn connection. */
    if (!existing || existing.type !== 'linkedin') webhookUrl = 'linkedin';
  } else if (type === 'telegram') {
    const prev = existing ? storedTelegram(existing) : null;
    if (body?.telegram === undefined) {
      if (!prev) throw badRequest('Telegram bot token and chat ID are required');
    } else {
      webhookUrl = serializeTelegramTarget(parseTelegramTarget(body.telegram, prev));
    }
  } else if (body?.webhookUrl !== undefined && body.webhookUrl !== '') {
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
    ...parseHtmlBranding(body, existing),
    active: body?.active === undefined ? (existing ? existing.active : true) : Boolean(body.active),
    useAi: body?.useAi === undefined ? (existing ? existing.useAi : true) : Boolean(body.useAi),
    ...(type === 'linkedin' ? parseLinkedIn(body?.linkedin, existing, userId) : {
      liUserId: null, liAuthor: null, postFormat: null, postTone: null, postLength: null,
      postLanguage: null, postsPerRun: null, maxPostsPerDay: null, requireApproval: null,
    }),
  };
}

/* LinkedIn channel settings. Whoever sets the author becomes the owner whose
   LinkedIn connection publishes; other edits keep the owner. */
function parseLinkedIn(b: any, existing: ChannelRow | undefined, userId: number | undefined) {
  const prev = existing?.type === 'linkedin' ? existing : undefined;
  const author = typeof b?.author === 'string' ? b.author : prev?.liAuthor ?? undefined;
  if (!author) throw badRequest('Choose who the channel publishes as');
  let liUserId = prev?.liUserId ?? null;
  if (!prev || author !== prev.liAuthor || !liUserId || b?.takeOver === true) {
    if (!userId) throw badRequest('Unknown user');
    try {
      resolveAuthor(userId, author);
    } catch (err) {
      if (err instanceof PublishError) throw badRequest(`LinkedIn: ${err.message}`);
      throw err;
    }
    liUserId = userId;
  }
  const pick = <T,>(v: unknown, ok: (x: unknown) => x is T, fallback: T, what: string): T => {
    if (v === undefined) return fallback;
    if (!ok(v)) throw badRequest(`Unknown ${what}`);
    return v;
  };
  const postFormat = pick(b?.format, isFormat, (prev?.postFormat as any) ?? 'News Analysis', 'format');
  const postTone = pick(b?.tone, isTone, (prev?.postTone as any) ?? 'Professional', 'tone');
  const postLength = pick(b?.length, isLength, (prev?.postLength as any) ?? 'medium', 'length');
  const postLanguage = pick(b?.language, (x): x is 'es' | 'en' => x === 'es' || x === 'en', (prev?.postLanguage as any) ?? 'es', 'language');
  const int = (v: unknown, fallback: number, min: number, max: number, what: string) => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${what} must be ${min}-${max}`);
    return n;
  };
  const postsPerRun = int(b?.postsPerRun, prev?.postsPerRun ?? LINKEDIN_DEFAULTS.postsPerRun, 1, 5, 'Posts per run');
  const maxPostsPerDay = int(b?.maxPostsPerDay, prev?.maxPostsPerDay ?? LINKEDIN_DEFAULTS.maxPostsPerDay, 1, 10, 'Posts per day');
  if (postsPerRun > maxPostsPerDay) throw badRequest('Posts per run cannot exceed posts per day');
  /* Default: a person approves Company Page posts; own-profile posts go out directly. */
  const requireApproval = b?.requireApproval === undefined ? (prev?.requireApproval ?? author !== 'member') : Boolean(b.requireApproval);
  return { liUserId, liAuthor: author, postFormat, postTone, postLength, postLanguage, postsPerRun, maxPostsPerDay, requireApproval };
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
    const v = parseChannelInput(req.body, undefined, req.auth!.user.id);
    if (channelRepository.count(tid) >= MAX_CHANNELS_PER_TENANT) {
      throw conflict(`A company can have at most ${MAX_CHANNELS_PER_TENANT} channels`);
    }
    const row = channelRepository.create(tid, { ...v, webhookUrl: encryptSecret(v.webhookUrl!) });
    rescheduleChannel(row.id);
    res.status(201).json({ channel: channelOut(channelRepository.findById(row.id)!) });
  },

  update(req: express.Request, res: express.Response) {
    const existing = channelOf(req);
    const v = parseChannelInput(req.body, existing, req.auth!.user.id);
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
      if (err instanceof WebhookError || err instanceof MailError) throw new HttpError(502, err.message);
      if (err instanceof PublishError) throw new HttpError(err.code === 'reconnect' ? 409 : 400, err.message);
      throw new HttpError(502, channel.type === 'email' ? 'Email delivery failed' : channel.type === 'telegram' ? 'Telegram request failed' : 'Webhook request failed');
    }
    res.json({ ok: true });
  },

  /* Renders the email layout with sample news for the editor, applying the
     same sanitising as saving would. Nothing is stored or sent. */
  previewEmail(req: express.Request, res: express.Response) {
    const b = parseHtmlBranding(req.body);
    const { headerText } = parseBranding({ header: req.body?.header ?? null });
    const tenant = tenantRepository.findById(tenantOf(req));
    res.json({ html: previewEmail({ headerText, footerText: null, ...b }, tenant) });
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

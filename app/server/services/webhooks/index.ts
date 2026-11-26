import type { ChannelType } from '../../db/schema';
import { flags } from '../../config';
import { postJson as realPostJson, WebhookError } from './http';
import { parseStoredTelegramTarget, telegramApiUrl } from './telegram';
import { countLabel, groupByTier, severityCounts, type ReportItem, type ReportLabels, type Tier } from '../reportLayout';

/* Slack / Rocket.Chat / Discord incoming webhooks and Telegram bots: URL
   validation, message rendering and delivery. The SSRF-guarded transport
   lives in ./http.ts. */

export type { ChannelType };
export { WebhookError };
export { isPublicAddress } from './address';

export function validateWebhookUrl(type: ChannelType, raw: unknown): { url: URL } | { error: string } {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'Webhook URL is required' };
  if (raw.length > 2048) return { error: 'Webhook URL is too long' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: 'Webhook URL is not a valid URL' };
  }
  if (url.username || url.password) return { error: 'Webhook URL must not contain credentials' };
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && flags.allowHttpWebhooks())) {
    return { error: 'Webhook URL must use https' };
  }
  if (type === 'slack') {
    if (url.hostname !== 'hooks.slack.com' || !/^\/(services|triggers|workflows)\//.test(url.pathname)) {
      return { error: 'Slack webhook URLs look like https://hooks.slack.com/services/…' };
    }
  } else if (type === 'rocketchat') {
    if (!/\/hooks\//.test(url.pathname)) {
      return { error: 'Rocket.Chat webhook URLs look like https://chat.example.com/hooks/…' };
    }
  } else if (type === 'discord') {
    if (!/^(?:(?:ptb|canary)\.)?discord(?:app)?\.com$/.test(url.hostname) || !/^\/api\/(?:v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      return { error: 'Discord webhook URLs look like https://discord.com/api/webhooks/…' };
    }
    if (url.protocol !== 'https:') return { error: 'Webhook URL must use https' };
  } else {
    return { error: 'Unknown channel type' };
  }
  return { url };
}

/* ------------------------------------------------------------------ */
/*  Message rendering                                                  */
/* ------------------------------------------------------------------ */

export type DigestItem = ReportItem;

export interface DigestMessage {
  heading: string;
  summary?: string | null;
  items: DigestItem[];
  footer: string;
  labels: ReportLabels;
}

const SEVERITY_UNICODE: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
const SEVERITY_EMOJI: Record<string, string> = {
  critical: ':red_circle:',
  high: ':large_orange_circle:',
  medium: ':large_yellow_circle:',
  low: ':large_green_circle:',
};

function slackEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdEscape(s: string): string {
  /* Rocket.Chat turns a bare @all / @here / @user into a mention; a
     zero-width space after "@" keeps the text readable but inert. */
  return s.replace(/([\\[\]()*_`~|])/g, '\\$1').replace(/@(?=\w)/g, '@\u200b');
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Discord Markdown; mentions are also disabled in the payload. */
function discordEscape(s: string): string {
  return s.replace(/([\\[\]()*_`~|>#-])/g, '\\$1').replace(/@(?=\w)/g, '@\u200b');
}

type Style = { esc: (s: string) => string; bold: (s: string) => string; italic: (s: string) => string; link: (title: string, url: string) => string };

const STYLES: Record<'slack' | 'markdown' | 'discord' | 'telegram', Style> = {
  slack: {
    esc: slackEscape,
    bold: (t) => `*${t}*`,
    italic: (t) => `_${t}_`,
    link: (t, u) => `<${u.replace(/[<>|]/g, '')}|${t.replace(/\|/g, '¦')}>`,
  },
  markdown: {
    esc: mdEscape,
    bold: (t) => `**${t}**`,
    italic: (t) => `_${t}_`,
    link: (t, u) => `[${t}](${u.replace(/[()\s]/g, encodeURIComponent)})`,
  },
  discord: {
    esc: discordEscape,
    bold: (t) => `**${t}**`,
    italic: (t) => `*${t}*`,
    /* <url> keeps Discord from unfurling every link into a preview card. */
    link: (t, u) => `[${t}](<${u.replace(/[<>()\s]/g, encodeURIComponent)}>)`,
  },
  telegram: {
    esc: htmlEscape,
    bold: (t) => `<b>${t}</b>`,
    italic: (t) => `<i>${t}</i>`,
    link: (t, u) => `<a href="${htmlEscape(u)}">${t}</a>`,
  },
};

function styleFor(type: ChannelType): Style {
  if (type === 'slack') return STYLES.slack;
  if (type === 'discord') return STYLES.discord;
  if (type === 'telegram') return STYLES.telegram;
  return STYLES.markdown;
}

/* Footer may span a few lines; each is italicised on its own because
   Slack/Rocket.Chat emphasis does not cross line breaks. */
function footerLines(type: ChannelType, footer: string): string[] {
  const st = styleFor(type);
  const lines = footer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? ['', ...lines.map((l) => st.italic(st.esc(l)))] : [];
}

export function renderTestPreview(type: ChannelType, msg: { heading: string; body: string; footer: string }): string {
  const st = styleFor(type);
  return [st.bold(st.esc(msg.heading)), '', st.esc(msg.body), ...footerLines(type, msg.footer)].join('\n');
}

/* Tests replace the network (Discord and Telegram hosts are fixed). */
let postJson = realPostJson;
export function setWebhookTransport(fn: typeof realPostJson | null): void {
  postJson = fn ?? realPostJson;
}

/* Plain text (no markup) as the target platform expects it. */
export function renderPlain(type: ChannelType, text: string): string {
  return type === 'telegram' ? htmlEscape(text) : text;
}

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

const TIER_EMOJI: Record<Tier, string> = { high: '🚨', medium: '🔶', low: '🔹', none: '▫️' };
const RULE = '━━━━━━━━';

function severityEmoji(type: ChannelType, sev: string): string {
  return type === 'slack' || type === 'rocketchat' ? SEVERITY_EMOJI[sev] ?? '' : SEVERITY_UNICODE[sev] ?? '';
}

/* One news item, three short lines at most:
     🔴 CRÍTICA · <title link>
        CVE-2026-1 · CVSS 9.8 · Source
        🔧 nginx 1.22.1 → actualizar a 1.27.1
        🖥 WEB01 · web01.local (alta)                                 */
function renderItem(type: ChannelType, st: Style, it: DigestItem, labels: ReportLabels): string[] {
  const sev = (it.severity || 'low').toLowerCase();
  const url = safeUrl(it.url);
  const title = st.esc(it.title);
  const link = url ? st.link(title, url) : title;
  const out = [`${severityEmoji(type, sev)} ${st.bold(st.esc(labels.severity[sev] ?? sev.toUpperCase()))} · ${link}`];
  const meta = [...(it.cves ?? []).slice(0, 3), ...(typeof it.cvss === 'number' ? [`CVSS ${it.cvss.toFixed(1)}`] : []), it.source]
    .filter(Boolean).map((m) => st.esc(m)).join(' · ');
  out.push(`      ${st.italic(meta)}`);
  if (it.fixes?.length) {
    const fixes = it.fixes.map((f) => {
      const cur = `${f.technology}${f.version ? ` ${f.version}` : ''}`;
      return f.fixedIn ? `${cur} → ${labels.updateTo ?? 'update to'} ${f.fixedIn}` : cur;
    });
    out.push(`      🔧 ${st.esc(fixes.join(' | '))}`);
  } else if (it.matchedTech.length) {
    out.push(`      🔧 ${st.esc(`${labels.affects}: ${it.matchedTech.join(', ')}`)}`);
  }
  if (it.assets?.length) out.push(`      🖥 ${st.esc(it.assets.join(' | '))}`);
  return out;
}

export function renderMessage(type: ChannelType, msg: DigestMessage): { text: string } {
  const st = styleFor(type);
  const lines: string[] = [st.bold(st.esc(msg.heading))];

  /* At-a-glance line: counts per severity and how many hit critical assets. */
  const counts = severityCounts(msg.items).map(([sev, n]) => `${severityEmoji(type, sev)} ${st.esc(countLabel(msg.labels, sev, n))}`);
  const critical = msg.items.filter((i) => i.tier === 'high').length;
  if (critical && msg.labels.inCritical) counts.push(`🚨 ${st.bold(st.esc(`${critical} ${msg.labels.inCritical}`))}`);
  if (counts.length) lines.push(counts.join('  ·  '));

  if (msg.summary) lines.push('', st.esc(msg.summary));

  for (const group of groupByTier(msg.items)) {
    if (group.tier) {
      const name = msg.labels.tiers?.[group.tier] ?? group.tier;
      lines.push('', `${RULE} ${TIER_EMOJI[group.tier]} ${st.bold(st.esc(`${name.toUpperCase()} (${group.items.length})`))} ${RULE}`);
    } else {
      lines.push('');
    }
    group.items.forEach((it, i) => {
      if (i > 0) lines.push('');
      lines.push(...renderItem(type, st, it, msg.labels));
    });
  }
  lines.push(...footerLines(type, msg.footer));
  return { text: lines.join('\n') };
}

/* Splits on line breaks so no piece exceeds `max` characters (Discord 2000,
   Telegram 4096); a single over-long line is cut. */
export function splitMessage(text: string, max: number): string[] {
  const parts: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const l = line.length > max ? line.slice(0, max - 1) + '…' : line;
    if (cur && cur.length + 1 + l.length > max) {
      parts.push(cur);
      cur = l;
    } else {
      cur = cur ? `${cur}\n${l}` : l;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

async function postOk(url: URL, payload: unknown, who: string): Promise<string> {
  const res = await postJson(url, payload);
  if (res.status < 200 || res.status >= 300) {
    throw new WebhookError(`${who} answered HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }
  return res.body;
}

/* `target` is the decrypted channel target: a webhook URL, or for Telegram
   the JSON with bot token and chat id. */
export async function deliver(type: ChannelType, target: string, text: string): Promise<void> {
  if (type === 'telegram') {
    let t;
    try {
      t = parseStoredTelegramTarget(target);
    } catch {
      throw new WebhookError('Telegram channel is misconfigured: set the bot token and chat ID again');
    }
    for (const part of splitMessage(text, 4000)) {
      const res = await postJson(telegramApiUrl(t, 'sendMessage'), {
        chat_id: t.chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true,
      });
      let desc = '';
      try { desc = String(JSON.parse(res.body)?.description ?? ''); } catch { /* not JSON */ }
      if (res.status < 200 || res.status >= 300) {
        throw new WebhookError(`Telegram refused the message (HTTP ${res.status})${desc ? `: ${desc.slice(0, 200)}` : ''}`);
      }
    }
    return;
  }

  const v = validateWebhookUrl(type, target);
  if ('error' in v) throw new WebhookError(v.error);
  if (type === 'discord') {
    for (const part of splitMessage(text, 1900)) {
      await postOk(v.url, { content: part, allowed_mentions: { parse: [] }, flags: 4 }, 'Discord');
    }
    return;
  }
  const payload = type === 'slack'
    ? { text, unfurl_links: false, unfurl_media: false }
    : { text };
  const body = await postOk(v.url, payload, 'Webhook');
  /* Rocket.Chat reports some failures as 200 with {"success": false}. */
  if (type === 'rocketchat') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && parsed.success === false) throw new WebhookError(`Rocket.Chat refused the message: ${String(parsed.error || '').slice(0, 200)}`);
    } catch (e) {
      if (e instanceof WebhookError) throw e;
    }
  }
}

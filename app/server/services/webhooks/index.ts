import type { ChannelType } from '../../db/schema';
import { flags } from '../../config';
import { postJson, WebhookError } from './http';

/* Slack / Rocket.Chat incoming webhooks: URL validation, message rendering
   and delivery. The SSRF-guarded transport lives in ./http.ts. */

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
  } else {
    return { error: 'Unknown channel type' };
  }
  return { url };
}

/* ------------------------------------------------------------------ */
/*  Message rendering                                                  */
/* ------------------------------------------------------------------ */

export interface DigestItem {
  title: string;
  url: string;
  source: string;
  severity: string;
  matchedTech: string[];
}

export interface DigestMessage {
  heading: string;
  summary?: string | null;
  items: DigestItem[];
  footer: string;
  labels: { severity: Record<string, string>; affects: string };
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
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

/* Footer may span a few lines; each is italicised on its own because
   Slack/Rocket.Chat emphasis does not cross line breaks. */
function footerLines(type: ChannelType, footer: string): string[] {
  const esc = type === 'slack' ? slackEscape : mdEscape;
  const lines = footer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? ['', ...lines.map((l) => `_${esc(l)}_`)] : [];
}

export function renderTestPreview(type: ChannelType, msg: { heading: string; body: string; footer: string }): string {
  const lines = type === 'slack'
    ? [`*${slackEscape(msg.heading)}*`, '', slackEscape(msg.body)]
    : [`**${mdEscape(msg.heading)}**`, '', mdEscape(msg.body)];
  return [...lines, ...footerLines(type, msg.footer)].join('\n');
}

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

function grouped(items: DigestItem[]): Array<[string, DigestItem[]]> {
  return SEVERITY_ORDER
    .map((sev) => [sev, items.filter((i) => (i.severity || 'low').toLowerCase() === sev)] as [string, DigestItem[]])
    .filter(([, list]) => list.length > 0);
}

export function renderMessage(type: ChannelType, msg: DigestMessage): { text: string } {
  const lines: string[] = [];
  if (type === 'slack') {
    lines.push(`*${slackEscape(msg.heading)}*`);
    if (msg.summary) lines.push('', slackEscape(msg.summary));
    for (const [sev, list] of grouped(msg.items)) {
      lines.push('', `${SEVERITY_EMOJI[sev] ?? ''} *${slackEscape(msg.labels.severity[sev] ?? sev.toUpperCase())}* (${list.length})`);
      for (const it of list) {
        const url = safeUrl(it.url);
        const title = slackEscape(it.title).replace(/\|/g, '¦');
        const link = url ? `<${url.replace(/[<>|]/g, '')}|${title}>` : title;
        const tech = it.matchedTech.length ? ` — _${msg.labels.affects}: ${slackEscape(it.matchedTech.join(', '))}_` : '';
        lines.push(`• ${link} · ${slackEscape(it.source)}${tech}`);
      }
    }
    lines.push(...footerLines(type, msg.footer));
  } else {
    lines.push(`**${mdEscape(msg.heading)}**`);
    if (msg.summary) lines.push('', mdEscape(msg.summary));
    for (const [sev, list] of grouped(msg.items)) {
      lines.push('', `${SEVERITY_EMOJI[sev] ?? ''} **${mdEscape(msg.labels.severity[sev] ?? sev.toUpperCase())}** (${list.length})`);
      for (const it of list) {
        const url = safeUrl(it.url);
        const title = mdEscape(it.title);
        const link = url ? `[${title}](${url.replace(/[()\s]/g, encodeURIComponent)})` : title;
        const tech = it.matchedTech.length ? ` — _${msg.labels.affects}: ${mdEscape(it.matchedTech.join(', '))}_` : '';
        lines.push(`• ${link} · ${mdEscape(it.source)}${tech}`);
      }
    }
    lines.push(...footerLines(type, msg.footer));
  }
  return { text: lines.join('\n') };
}

export async function deliver(type: ChannelType, webhookUrl: string, text: string): Promise<void> {
  const v = validateWebhookUrl(type, webhookUrl);
  if ('error' in v) throw new WebhookError(v.error);
  const payload = type === 'slack'
    ? { text, unfurl_links: false, unfurl_media: false }
    : { text };
  const res = await postJson(v.url, payload);
  if (res.status < 200 || res.status >= 300) {
    throw new WebhookError(`Webhook answered HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  }
  /* Rocket.Chat reports some failures as 200 with {"success": false}. */
  if (type === 'rocketchat') {
    try {
      const parsed = JSON.parse(res.body);
      if (parsed && parsed.success === false) throw new WebhookError(`Rocket.Chat refused the message: ${String(parsed.error || '').slice(0, 200)}`);
    } catch (e) {
      if (e instanceof WebhookError) throw e;
    }
  }
}

import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

/* Outbound delivery to Slack / Rocket.Chat incoming webhooks.

   Webhook URLs are typed in by company admins, so the server must not become a
   way to reach internal services (SSRF). Every request:
   - only goes to https (http only with CYBERPULSE_ALLOW_HTTP_WEBHOOKS=true)
   - resolves DNS itself and refuses private, loopback, link-local and other
     non-public addresses, then connects to exactly the address it checked
     (no rebinding window)
   - never follows redirects, times out, and caps the response it reads.
   Rocket.Chat servers on a private LAN can be allowed explicitly with
   CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS=true.                                    */

export type ChannelType = 'slack' | 'rocketchat';

export class WebhookError extends Error {}

function allowHttp() {
  return process.env.CYBERPULSE_ALLOW_HTTP_WEBHOOKS === 'true';
}
function allowPrivate() {
  return process.env.CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS === 'true';
}

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
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowHttp())) {
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

export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return false;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^f[cd]/.test(lower)) return false; // unique local
    if (/^fe[89ab]/.test(lower)) return false; // link-local
    if (/^ff/.test(lower)) return false; // multicast
    return true;
  }
  return false;
}

/* dns.lookup replacement handed to http(s).request: the socket connects to
   the address this function approved, nothing else. */
function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = (addresses as dns.LookupAddress[]);
    const blocked = list.find((a) => !isPublicAddress(a.address));
    if (blocked && !allowPrivate()) {
      return callback(Object.assign(new Error(`Refusing to connect to non-public address ${blocked.address}`), { code: 'EBLOCKED' }), '', 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

export async function postJson(url: URL, payload: unknown, timeoutMs = 15_000): Promise<{ status: number; body: string }> {
  if (net.isIP(url.hostname) && !isPublicAddress(url.hostname) && !allowPrivate()) {
    throw new WebhookError(`Refusing to connect to non-public address ${url.hostname}`);
  }
  const body = JSON.stringify(payload);
  const mod = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'HackerDo-CyberPulse/1.0',
      },
      lookup: guardedLookup as unknown as typeof dns.lookup,
      timeout: timeoutMs,
    }, (res) => {
      let received = 0;
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received <= 16 * 1024) chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new WebhookError('Webhook request timed out')));
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(err instanceof WebhookError ? err : new WebhookError(err.code === 'EBLOCKED' ? err.message : `Webhook request failed: ${err.code || err.message}`));
    });
    req.end(body);
  });
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
  return s.replace(/([\\[\]()*_`~|])/g, '\\$1');
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
    lines.push('', `_${slackEscape(msg.footer)}_`);
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
    lines.push('', `_${mdEscape(msg.footer)}_`);
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

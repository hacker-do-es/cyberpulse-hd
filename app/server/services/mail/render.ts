import { escapeHtml, fillPlaceholdersHtml } from './html';

/* The digest as an email: a table layout that renders the same in Gmail,
   Outlook and Apple Mail, plus a plain-text alternative. Neutral styling,
   no product branding: the company's own header/footer carry that. */

export interface EmailItem {
  title: string;
  url: string;
  source: string;
  severity: string;
  matchedTech: string[];
}

export interface EmailDigest {
  subject: string;
  company: string;
  count: number;
  /* Sanitised HTML; null = default header (the subject as a title). */
  headerHtml: string | null;
  /* Sanitised HTML; null = default text footer, '' = none. */
  footerHtml: string | null;
  defaultFooter: string;
  summary: string | null;
  items: EmailItem[];
  /* Free text shown instead of the item list (test message). */
  body?: string;
  labels: { severity: Record<string, string>; affects: string; summary: string };
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const SEVERITY_COLOR: Record<string, string> = { critical: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#15803d' };
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

function grouped(items: EmailItem[]): Array<[string, EmailItem[]]> {
  return SEVERITY_ORDER
    .map((sev) => [sev, items.filter((i) => (i.severity || 'low').toLowerCase() === sev)] as [string, EmailItem[]])
    .filter(([, list]) => list.length > 0);
}

const row = (inner: string, pad = '8px 28px') => `<tr><td style="padding:${pad};font-family:${FONT};">${inner}</td></tr>`;

export function renderEmailHtml(d: EmailDigest): string {
  const parts: string[] = [];

  parts.push(row(
    d.headerHtml !== null && d.headerHtml !== ''
      ? fillPlaceholdersHtml(d.headerHtml, d.company, d.count)
      : `<h1 style="margin:0;font-size:20px;line-height:1.3;color:#111827;font-weight:700;">${escapeHtml(d.subject)}</h1>`,
    '24px 28px 12px',
  ));

  if (d.body) {
    parts.push(row(`<p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">${escapeHtml(d.body)}</p>`));
  }

  if (d.summary) {
    const lines = d.summary.split(/\n+/).map((l) => l.trim()).filter(Boolean).map(escapeHtml).join('<br>');
    parts.push(row(
      `<div style="background:#f9fafb;border-left:3px solid #6b7280;border-radius:4px;padding:12px 16px;">` +
      `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">${escapeHtml(d.labels.summary)}</div>` +
      `<div style="font-size:14px;line-height:1.6;color:#1f2937;">${lines}</div></div>`,
    ));
  }

  for (const [sev, list] of grouped(d.items)) {
    const color = SEVERITY_COLOR[sev] ?? '#374151';
    const label = escapeHtml(d.labels.severity[sev] ?? sev.toUpperCase());
    const items = list.map((it) => {
      const url = safeUrl(it.url);
      const title = escapeHtml(it.title);
      const link = url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8;text-decoration:none;font-weight:600;">${title}</a>`
        : `<span style="font-weight:600;color:#111827;">${title}</span>`;
      const tech = it.matchedTech.length
        ? ` · ${escapeHtml(d.labels.affects)}: <span style="color:#111827;">${escapeHtml(it.matchedTech.join(', '))}</span>`
        : '';
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-family:${FONT};">` +
        `<div style="font-size:15px;line-height:1.4;">${link}</div>` +
        `<div style="font-size:12px;line-height:1.5;color:#6b7280;margin-top:2px;">${escapeHtml(it.source)}${tech}</div></td></tr>`;
    }).join('');
    parts.push(row(
      `<div style="margin-top:10px;"><span style="display:inline-block;background:${color};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:.06em;border-radius:3px;padding:3px 8px;">${label}</span>` +
      ` <span style="font-size:12px;color:#6b7280;">(${list.length})</span></div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table>`,
    ));
  }

  const footer = d.footerHtml === null
    ? `<p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">${escapeHtml(d.defaultFooter).replace(/\n/g, '<br>')}</p>`
    : d.footerHtml === '' ? '' : fillPlaceholdersHtml(d.footerHtml, d.company, d.count);
  if (footer) parts.push(row(`<div style="border-top:1px solid #e5e7eb;padding-top:16px;">${footer}</div>`, '16px 28px 24px'));
  else parts.push(row('', '0 0 16px'));

  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(d.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f3f4f6;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">` +
    parts.join('') +
    '</table></td></tr></table></body></html>';
}

/* Plain-text alternative: same content, links spelled out. */
export function renderEmailText(d: EmailDigest): string {
  const lines: string[] = [d.subject];
  if (d.body) lines.push('', d.body);
  if (d.summary) lines.push('', `${d.labels.summary}:`, d.summary);
  for (const [sev, list] of grouped(d.items)) {
    lines.push('', `${d.labels.severity[sev] ?? sev.toUpperCase()} (${list.length})`);
    for (const it of list) {
      const tech = it.matchedTech.length ? ` — ${d.labels.affects}: ${it.matchedTech.join(', ')}` : '';
      lines.push(`- ${it.title} · ${it.source}${tech}`);
      const url = safeUrl(it.url);
      if (url) lines.push(`  ${url}`);
    }
  }
  if (d.footerHtml === null && d.defaultFooter) lines.push('', '--', d.defaultFooter);
  else if (d.footerHtml) {
    const t = htmlToText(fillPlaceholdersHtml(d.footerHtml, d.company, d.count));
    if (t) lines.push('', '--', t);
  }
  return lines.join('\n');
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-4]|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

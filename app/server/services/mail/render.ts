import { escapeHtml, fillPlaceholdersHtml } from './html';
import { countLabel, groupByTier, severityCounts, type ReportItem, type ReportLabels, type Tier } from '../reportLayout';

/* The digest as an email: a table layout that renders the same in Gmail,
   Outlook and Apple Mail, plus a plain-text alternative. Neutral styling,
   no product branding: the company's own header/footer carry that. */

export type EmailItem = ReportItem;

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
  labels: ReportLabels & { summary: string };
}

const SEVERITY_COLOR: Record<string, string> = { critical: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#15803d' };
const TIER_COLOR: Record<Tier, string> = { high: '#b91c1c', medium: '#c2410c', low: '#2563eb', none: '#6b7280' };
const CRIT_CHIP: Record<string, string> = { high: '#fee2e2;color:#991b1b', medium: '#ffedd5;color:#9a3412', low: '#e0e7ff;color:#3730a3' };
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
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

  /* At a glance: counts per severity, and how many hit critical assets. */
  const counts = severityCounts(d.items);
  const critical = d.items.filter((i) => i.tier === 'high').length;
  if (counts.length) {
    const chips = counts.map(([sev, n]) =>
      `<span style="display:inline-block;background:${SEVERITY_COLOR[sev] ?? '#374151'};color:#ffffff;font-size:12px;font-weight:700;border-radius:12px;padding:4px 10px;margin:0 6px 6px 0;">${escapeHtml(countLabel(d.labels, sev, n))}</span>`).join('');
    const crit = critical && d.labels.inCritical
      ? `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:12px;font-weight:700;border-radius:12px;padding:3px 10px;margin:0 6px 6px 0;">&#9888; ${critical} ${escapeHtml(d.labels.inCritical)}</span>`
      : '';
    parts.splice(1, 0, row(`<div>${chips}${crit}</div>`, '4px 28px 8px'));
  }

  for (const group of groupByTier(d.items)) {
    if (group.tier) {
      const name = escapeHtml((d.labels.tiers?.[group.tier] ?? group.tier).toUpperCase());
      parts.push(row(
        `<div style="margin-top:14px;border-left:4px solid ${TIER_COLOR[group.tier]};padding:6px 12px;background:#f9fafb;border-radius:0 4px 4px 0;">` +
        `<span style="font-size:13px;font-weight:800;letter-spacing:.06em;color:${TIER_COLOR[group.tier]};">${name}</span>` +
        ` <span style="font-size:12px;color:#6b7280;">(${group.items.length})</span></div>`,
        '8px 28px 4px',
      ));
    }
    parts.push(row(group.items.map((it) => card(it, d.labels)).join(''), '4px 28px'));
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

function card(it: EmailItem, labels: EmailDigest['labels']): string {
  const sev = (it.severity || 'low').toLowerCase();
  const color = SEVERITY_COLOR[sev] ?? '#374151';
  const url = safeUrl(it.url);
  const title = escapeHtml(it.title);
  const link = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:#111827;text-decoration:none;font-weight:700;">${title}</a>`
    : `<span style="font-weight:700;color:#111827;">${title}</span>`;
  const pills = `<span style="display:inline-block;background:${color};color:#ffffff;font-size:10px;font-weight:800;letter-spacing:.06em;border-radius:3px;padding:2px 7px;">${escapeHtml(labels.severity[sev] ?? sev.toUpperCase())}</span>` +
    (typeof it.cvss === 'number' ? ` <span style="display:inline-block;border:1px solid ${color};color:${color};font-size:10px;font-weight:700;border-radius:3px;padding:1px 6px;">CVSS ${it.cvss.toFixed(1)}</span>` : '');
  const meta = [...(it.cves ?? []).slice(0, 3), it.source].filter(Boolean).map(escapeHtml).join(' &middot; ');
  let fix = '';
  if (it.fixes?.length) {
    fix = it.fixes.map((f) => {
      const cur = escapeHtml(`${f.technology}${f.version ? ` ${f.version}` : ''}`);
      return f.fixedIn
        ? `<span style="color:#111827;font-weight:600;">${cur}</span> &rarr; <span style="color:#15803d;font-weight:700;">${escapeHtml(labels.updateTo ?? 'update to')} ${escapeHtml(f.fixedIn)}</span>`
        : `<span style="color:#111827;font-weight:600;">${cur}</span>`;
    }).join('<br>');
  } else if (it.matchedTech.length) {
    fix = `${escapeHtml(labels.affects)}: <span style="color:#111827;font-weight:600;">${escapeHtml(it.matchedTech.join(', '))}</span>`;
  }
  const assets = it.assets?.length
    ? `<div style="margin-top:6px;">${it.assets.map((a) => {
      const crit = /\((alta|high)\)$/i.test(a) ? 'high' : /\((media|medium)\)$/i.test(a) ? 'medium' : 'low';
      return `<span style="display:inline-block;background:${CRIT_CHIP[crit]};font-size:11px;border-radius:3px;padding:2px 6px;margin:0 4px 4px 0;font-family:Menlo,Consolas,monospace;">${escapeHtml(a)}</span>`;
    }).join('')}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:4px;">` +
    `<tr><td style="padding:10px 12px;font-family:${FONT};">` +
    `<div>${pills}</div>` +
    `<div style="font-size:15px;line-height:1.35;margin-top:6px;">${link}</div>` +
    `<div style="font-size:12px;line-height:1.5;color:#6b7280;margin-top:2px;">${meta}</div>` +
    (fix ? `<div style="font-size:13px;line-height:1.6;color:#374151;margin-top:6px;">&#128295; ${fix}</div>` : '') +
    assets +
    `</td></tr></table>`;
}

/* Plain-text alternative: same content, links spelled out. */
export function renderEmailText(d: EmailDigest): string {
  const lines: string[] = [d.subject];
  if (d.body) lines.push('', d.body);
  if (d.summary) lines.push('', `${d.labels.summary}:`, d.summary);
  const counts = severityCounts(d.items).map(([sev, n]) => countLabel(d.labels, sev, n));
  const critical = d.items.filter((i) => i.tier === 'high').length;
  if (critical && d.labels.inCritical) counts.push(`${critical} ${d.labels.inCritical}`);
  if (counts.length) lines.splice(1, 0, counts.join(' · '));
  for (const group of groupByTier(d.items)) {
    if (group.tier) lines.push('', `== ${(d.labels.tiers?.[group.tier] ?? group.tier).toUpperCase()} (${group.items.length}) ==`);
    for (const it of group.items) {
      const sev = (it.severity || 'low').toLowerCase();
      lines.push('', `[${d.labels.severity[sev] ?? sev.toUpperCase()}] ${it.title}`);
      const meta = [...(it.cves ?? []).slice(0, 3), ...(typeof it.cvss === 'number' ? [`CVSS ${it.cvss.toFixed(1)}`] : []), it.source];
      lines.push(`  ${meta.join(' · ')}`);
      if (it.fixes?.length) {
        for (const f of it.fixes) lines.push(`  ${f.technology}${f.version ? ` ${f.version}` : ''}${f.fixedIn ? ` -> ${d.labels.updateTo ?? 'update to'} ${f.fixedIn}` : ''}`);
      } else if (it.matchedTech.length) lines.push(`  ${d.labels.affects}: ${it.matchedTech.join(', ')}`);
      if (it.assets?.length) lines.push(`  ${d.labels.assets ?? 'assets'}: ${it.assets.join(', ')}`);
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

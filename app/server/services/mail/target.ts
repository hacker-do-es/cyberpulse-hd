import { badRequest } from '../../lib/http';

/* Where an email channel delivers: its recipients and its own SMTP server.
   Stored as JSON, encrypted at rest in channels.webhook_url (the password
   with it). The password never leaves the server. */

export const MAX_RECIPIENTS = 20;
export const SMTP_PORTS = [25, 465, 587, 2525] as const;
export type SmtpSecurity = 'tls' | 'starttls';

export interface SmtpSettings {
  host: string;
  port: number;
  /* 'tls' = implicit TLS (465); 'starttls' = plain connect + mandatory STARTTLS. */
  security: SmtpSecurity;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
}

export interface EmailTarget {
  recipients: string[];
  smtp: SmtpSettings;
}

/* Deliberately strict: one address, no display name, no spaces or line
   breaks (header injection), a dotted domain. */
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function isEmailAddress(s: string): boolean {
  return s.length <= 254 && EMAIL_RE.test(s);
}

export function parseRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,;]+/) : null;
  if (!list) throw badRequest('recipients must be a list of email addresses');
  const out = [...new Set(list.map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
  if (out.length === 0) throw badRequest('Add at least one recipient');
  if (out.length > MAX_RECIPIENTS) throw badRequest(`At most ${MAX_RECIPIENTS} recipients per channel`);
  const bad = out.find((r) => !isEmailAddress(r));
  if (bad) throw badRequest(`Not a valid email address: ${bad.slice(0, 80)}`);
  return out;
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim() : '').slice(0, max + 1);

/* Validates the SMTP block of a create/update. On update an empty password
   keeps the stored one. */
export function parseSmtp(input: unknown, existing?: SmtpSettings): SmtpSettings {
  if (!input || typeof input !== 'object') {
    if (existing) return existing;
    throw badRequest('SMTP settings are required');
  }
  const raw = input as Partial<Record<keyof SmtpSettings, unknown>>;
  const host = text(raw.host ?? existing?.host, 253).toLowerCase();
  if (!HOST_RE.test(host)) throw badRequest('SMTP server must be a host name such as smtp.gmail.com');

  const port = Number(raw.port ?? existing?.port ?? 587);
  if (!(SMTP_PORTS as readonly number[]).includes(port)) throw badRequest(`SMTP port must be one of ${SMTP_PORTS.join(', ')}`);

  const security = (raw.security ?? existing?.security ?? (port === 465 ? 'tls' : 'starttls')) as SmtpSecurity;
  if (security !== 'tls' && security !== 'starttls') throw badRequest('SMTP security must be "tls" or "starttls"');

  const user = text(raw.user ?? existing?.user, 254);
  if (!user || user.length > 254 || /[\r\n]/.test(user)) throw badRequest('SMTP user is required');

  let password = typeof raw.password === 'string' && raw.password !== '' ? raw.password : existing?.password ?? '';
  if (!password) throw badRequest('SMTP password is required');
  if (password.length > 512) throw badRequest('SMTP password is too long');
  /* Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"). */
  if (/^[a-z]{4}( [a-z]{4}){3}$/.test(password)) password = password.replace(/ /g, '');

  const fromAddress = text(raw.fromAddress ?? existing?.fromAddress ?? user, 254).toLowerCase();
  if (!isEmailAddress(fromAddress)) throw badRequest('Sender address is not a valid email address');

  const fromName = text(raw.fromName ?? existing?.fromName, 80).replace(/[\r\n"<>]/g, '').trim();
  if (fromName.length > 80) throw badRequest('Sender name can be at most 80 characters');

  return { host, port, security, user, password, fromAddress, fromName };
}

export function serializeTarget(t: EmailTarget): string {
  return JSON.stringify(t);
}

export function parseStoredTarget(plain: string): EmailTarget {
  const t = JSON.parse(plain) as EmailTarget;
  if (!t || !Array.isArray(t.recipients) || !t.smtp) throw new Error('Corrupt email channel settings');
  return t;
}

/* What the UI may see: everything except the password. */
export function publicTarget(t: EmailTarget) {
  const { password, ...smtp } = t.smtp;
  return { recipients: t.recipients, smtp: { ...smtp, passwordSet: Boolean(password) } };
}

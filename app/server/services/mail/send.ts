import dns from 'dns/promises';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { flags } from '../../config';
import { isPublicAddress } from '../webhooks/address';
import type { EmailTarget } from './target';

/* Sends a digest through the channel's own SMTP server.
   - The host is resolved here and must be a public address (same rule and
     same override, CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS, as webhooks), and the
     socket connects to exactly that address: a company cannot use its
     channel to probe the network CyberPulse runs on.
   - Only mail ports are accepted (target.ts) and TLS is mandatory: implicit
     TLS on 465, STARTTLS required otherwise; certificates are verified
     against the host name.
   - One message per recipient, so recipients never see each other. */

export class MailError extends Error {}

export interface OutgoingEmail {
  subject: string;
  html: string;
  text: string;
}

export interface SendReport {
  sent: string[];
  failed: Array<{ to: string; error: string }>;
}

type Transport = Pick<Transporter, 'sendMail' | 'close'>;
type Factory = (options: SMTPPool.Options) => Transport;

let factory: Factory = (options) => nodemailer.createTransport(options);

/* Tests swap in an in-memory transport. */
export function setMailTransportFactory(f: Factory | null): void {
  factory = f ?? ((options) => nodemailer.createTransport(options));
}

async function resolvePublic(host: string): Promise<string> {
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch (err) {
    throw new MailError(`Cannot resolve SMTP server ${host} (${(err as NodeJS.ErrnoException)?.code || 'DNS error'})`);
  }
  if (addrs.length === 0) throw new MailError(`Cannot resolve SMTP server ${host}`);
  const blocked = addrs.find((a) => !isPublicAddress(a.address));
  if (blocked && !flags.allowPrivateWebhooks()) {
    throw new MailError(`Refusing to connect to non-public address ${blocked.address}`);
  }
  return addrs[0].address;
}

type SmtpFailure = { code?: string; response?: string; message?: string };

export function describeSmtpError(err: unknown): string {
  const e = (err ?? {}) as SmtpFailure;
  const code = e.code ? `${e.code}: ` : '';
  const detail = String(e.response || e.message || err).replace(/\s+/g, ' ');
  return `${code}${detail}`.slice(0, 240);
}

export async function sendEmail(target: EmailTarget, mail: OutgoingEmail): Promise<SendReport> {
  const { smtp } = target;
  const address = await resolvePublic(smtp.host);
  const transport = factory({
    host: address,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    auth: { user: smtp.user, pass: smtp.password },
    tls: { servername: smtp.host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    /* One connection, one login, reused for every recipient. */
    pool: true,
    maxConnections: 1,
  });

  const report: SendReport = { sent: [], failed: [] };
  try {
    for (const to of target.recipients) {
      try {
        await transport.sendMail({
          from: { name: smtp.fromName || smtp.fromAddress, address: smtp.fromAddress },
          to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
        });
        report.sent.push(to);
      } catch (err) {
        report.failed.push({ to, error: describeSmtpError(err) });
        /* Wrong credentials or an unreachable server fail the same way for
           every recipient: stop instead of hammering the server. */
        if (['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS'].includes((err as SmtpFailure)?.code ?? '')) {
          for (const rest of target.recipients.slice(target.recipients.indexOf(to) + 1)) {
            report.failed.push({ to: rest, error: 'not attempted' });
          }
          break;
        }
      }
    }
  } finally {
    transport.close();
  }
  return report;
}

/* One-line outcome for the delivery history. */
export function summarizeReport(r: SendReport): string {
  if (r.failed.length === 0) return `${r.sent.length} recipient${r.sent.length === 1 ? '' : 's'}`;
  const first = r.failed.find((f) => f.error !== 'not attempted') ?? r.failed[0];
  return `${r.sent.length}/${r.sent.length + r.failed.length} recipients; ${first.to}: ${first.error}`;
}

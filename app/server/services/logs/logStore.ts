import util from 'util';
import { getSqlite } from '../../db/client';

/* Application log for the superadmin "Logs" tab.

   - Every console.* line of the server is also kept here (installConsoleCapture),
     with its leading [TAG] as the source.
   - audit() records security-relevant actions (who, from where, what).
   Writes are queued and flushed in batches, never on the request path, and
   every message is redacted first. Kept 14 days, at most 50 000 rows. */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogKind = 'app' | 'audit';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  source: string;
  kind: LogKind;
  message: string;
  userId: number | null;
  username: string | null;
  tenantId: number | null;
  ip: string | null;
}

export const RETENTION_DAYS = 14;
export const MAX_ROWS = 50_000;
const MAX_MESSAGE = 4000;
const MAX_QUEUE = 5000;
const FLUSH_MS = 1000;

/* ------------------------------------------------------------------ */
/*  Redaction                                                          */
/* ------------------------------------------------------------------ */

const REDACTIONS: Array<[RegExp, string]> = [
  /* Authorization headers and bearer tokens */
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  /* key=value / "key": "value" pairs whose key looks secret */
  [/((?:pass(?:word)?|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|authorization|cookie|session|totp|otp)["']?\s*[:=]\s*["']?)[^\s"',;&]{3,}/gi, '$1[REDACTED]'],
  /* Well-known key formats */
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, '[REDACTED]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[REDACTED]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED]'],
  /* Telegram bot tokens (also inside api.telegram.org/bot<token>/ URLs) */
  [/\b\d{5,15}:[A-Za-z0-9_-]{30,64}\b/g, '[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED]'],
  /* Webhook URLs carry their secret in the path */
  [/(https:\/\/hooks\.slack\.com\/services\/)[^\s"']+/gi, '$1[REDACTED]'],
  [/(\/hooks\/)[A-Za-z0-9/_-]{16,}/g, '$1[REDACTED]'],
  /* Credentials embedded in URLs: scheme://user:pass@host */
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[REDACTED]@'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Queue                                                              */
/* ------------------------------------------------------------------ */

const queue: LogEntry[] = [];
let ready = false;
let flushing = false;
let timer: NodeJS.Timeout | null = null;
let dropped = 0;

/* The real console, for echoing audit lines without capturing them twice. */
const original = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

const TAG_RE = /^\[([A-Za-z0-9_-]{2,24})\]\s*/;

export function parseLine(text: string): { source: string; message: string } {
  const m = TAG_RE.exec(text);
  return m ? { source: m[1].toUpperCase(), message: text.slice(m[0].length) } : { source: 'APP', message: text };
}

function enqueue(e: Omit<LogEntry, 'ts' | 'message'> & { message: string; ts?: string }): void {
  if (queue.length >= MAX_QUEUE) {
    queue.shift();
    dropped++;
  }
  queue.push({
    ...e,
    ts: e.ts ?? new Date().toISOString(),
    message: redact(e.message).slice(0, MAX_MESSAGE),
  });
}

export function flushLogs(): number {
  if (!ready || flushing || queue.length === 0) return 0;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  try {
    const db = getSqlite();
    const ins = db.prepare(
      'INSERT INTO app_logs (ts, level, source, kind, message, user_id, username, tenant_id, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    db.transaction((rows: LogEntry[]) => {
      if (dropped > 0) {
        ins.run(new Date().toISOString(), 'warn', 'LOGS', 'app', `${dropped} log line(s) dropped: queue full`, null, null, null, null);
        dropped = 0;
      }
      for (const r of rows) ins.run(r.ts, r.level, r.source, r.kind, r.message, r.userId, r.username, r.tenantId, r.ip);
    })(batch);
    return batch.length;
  } catch (err) {
    /* Never let logging break the app; say so once on the real console. */
    original.error('[LOGS] Could not store log lines:', err instanceof Error ? err.message : err);
    return 0;
  } finally {
    flushing = false;
  }
}

/* Deletes rows older than RETENTION_DAYS and beyond MAX_ROWS. */
export function pruneLogs(now = Date.now()): number {
  const db = getSqlite();
  const cutoff = new Date(now - RETENTION_DAYS * 86_400_000).toISOString();
  let n = db.prepare('DELETE FROM app_logs WHERE ts < ?').run(cutoff).changes;
  const max = db.prepare('SELECT MAX(id) AS m FROM app_logs').get() as { m: number | null };
  if (max.m !== null) n += db.prepare('DELETE FROM app_logs WHERE id <= ?').run(max.m - MAX_ROWS).changes;
  return n;
}

/* Called once the database is open. Lines logged before are kept in the queue. */
export function startLogStore(): void {
  if (ready) return;
  ready = true;
  flushLogs();
  timer = setInterval(flushLogs, FLUSH_MS);
  timer.unref();
  const prune = setInterval(() => {
    try { pruneLogs(); } catch { /* next time */ }
  }, 3600_000);
  prune.unref();
  try { pruneLogs(); } catch { /* ignore */ }
  process.once('beforeExit', () => flushLogs());
}

/* Tests: stop the timer and forget queued lines. */
export function resetLogStore(): void {
  if (timer) clearInterval(timer);
  timer = null;
  ready = false;
  queue.length = 0;
}

/* ------------------------------------------------------------------ */
/*  Console capture                                                    */
/* ------------------------------------------------------------------ */

let captured = false;

export function installConsoleCapture(): void {
  if (captured) return;
  captured = true;
  const wrap = (method: keyof typeof original, level: LogLevel) => {
    (console as unknown as Record<string, (...a: unknown[]) => void>)[method] = (...args: unknown[]) => {
      original[method](...args);
      try {
        const text = util.format(...args);
        const { source, message } = parseLine(text);
        enqueue({ level, source, kind: 'app', message, userId: null, username: null, tenantId: null, ip: null });
      } catch { /* ignore */ }
    };
  };
  wrap('log', 'info');
  wrap('info', 'info');
  wrap('debug', 'info');
  wrap('warn', 'warn');
  wrap('error', 'error');
}

/* ------------------------------------------------------------------ */
/*  Audit                                                              */
/* ------------------------------------------------------------------ */

export interface AuditFields {
  action: string;
  detail?: string;
  level?: LogLevel;
  userId?: number | null;
  username?: string | null;
  tenantId?: number | null;
  ip?: string | null;
}

export function audit(f: AuditFields): void {
  const message = f.detail ? `${f.action} ${f.detail}` : f.action;
  const who = f.username ? `${f.username}${f.userId ? `#${f.userId}` : ''}` : f.userId ? `#${f.userId}` : '-';
  original.log(redact(`[AUDIT] ${message} | user=${who} tenant=${f.tenantId ?? '-'} ip=${f.ip ?? '-'}`));
  enqueue({
    level: f.level ?? 'info',
    source: 'AUDIT',
    kind: 'audit',
    message,
    userId: f.userId ?? null,
    username: f.username ?? null,
    tenantId: f.tenantId ?? null,
    ip: f.ip ?? null,
  });
}

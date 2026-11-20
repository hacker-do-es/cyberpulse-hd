import type express from 'express';
import { getSqlite } from '../db/client';
import type { LogLevel } from '../services/logs/logStore';
import { flushLogs } from '../services/logs/logStore';

/* Superadmin: read the application log (services/logs/logStore.ts). */

const LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

interface Row {
  id: number; ts: string; level: LogLevel; source: string; kind: 'app' | 'audit'; message: string;
  user_id: number | null; username: string | null; tenant_id: number | null; ip: string | null;
}

function str(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/* Filters from the query string, as a WHERE clause with bound parameters. */
function where(q: express.Request['query']): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  const levels = str(q.level).split(',').filter((l): l is LogLevel => (LEVELS as string[]).includes(l));
  if (levels.length && levels.length < LEVELS.length) {
    parts.push(`level IN (${levels.map(() => '?').join(',')})`);
    args.push(...levels);
  }
  const sources = str(q.source, 500).split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9_-]{1,24}$/.test(s)).slice(0, 20);
  if (sources.length) {
    parts.push(`source IN (${sources.map(() => '?').join(',')})`);
    args.push(...sources);
  }
  const kind = str(q.kind);
  if (kind === 'app' || kind === 'audit') { parts.push('kind = ?'); args.push(kind); }
  const text = str(q.q, 200);
  if (text) {
    /* Every word must appear in the source, message, user or IP. */
    for (const w of text.split(/\s+/).filter(Boolean).slice(0, 8)) {
      const like = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      parts.push("(source LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\' OR IFNULL(username,'') LIKE ? ESCAPE '\\' OR IFNULL(ip,'') LIKE ? ESCAPE '\\')");
      args.push(like, like, like, like);
    }
  }
  const from = str(q.from); const to = str(q.to);
  if (ISO_RE.test(from)) { parts.push('ts >= ?'); args.push(new Date(from).toISOString()); }
  if (ISO_RE.test(to)) { parts.push('ts <= ?'); args.push(new Date(to).toISOString()); }
  const tenant = Number(q.tenant);
  if (Number.isInteger(tenant) && tenant > 0) { parts.push('tenant_id = ?'); args.push(tenant); }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

const toJson = (r: Row) => ({
  id: r.id, ts: r.ts, level: r.level, source: r.source, kind: r.kind, message: r.message,
  userId: r.user_id, username: r.username, tenantId: r.tenant_id, ip: r.ip,
});

export const logsController = {
  /* Newest first; ?before=<id> pages back, ?after=<id> returns only newer rows (auto-refresh). */
  list(req: express.Request, res: express.Response) {
    flushLogs();
    const w = where(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const before = Number(req.query.before);
    const after = Number(req.query.after);
    const extra: string[] = [];
    const args = [...w.args];
    if (Number.isInteger(before) && before > 0) { extra.push('id < ?'); args.push(before); }
    if (Number.isInteger(after) && after > 0) { extra.push('id > ?'); args.push(after); }
    const clause = [w.sql, extra.length ? `${w.sql ? 'AND' : 'WHERE'} ${extra.join(' AND ')}` : ''].join(' ');
    const db = getSqlite();
    const rows = db.prepare(`SELECT * FROM app_logs ${clause} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1) as Row[];
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM app_logs ${w.sql}`).get(...w.args) as { n: number }).n;
    res.set('Cache-Control', 'no-store').json({ entries: rows.slice(0, limit).map(toJson), hasMore: rows.length > limit, total });
  },

  sources(_req: express.Request, res: express.Response) {
    flushLogs();
    const rows = getSqlite().prepare('SELECT source, COUNT(*) AS n FROM app_logs GROUP BY source ORDER BY source').all() as Array<{ source: string; n: number }>;
    res.set('Cache-Control', 'no-store').json({ sources: rows });
  },

  /* Plain-text download of the filtered log (up to 50 000 lines, oldest first). */
  exportTxt(req: express.Request, res: express.Response) {
    flushLogs();
    const w = where(req.query);
    const rows = getSqlite().prepare(`SELECT * FROM app_logs ${w.sql} ORDER BY id ASC LIMIT 50000`).all(...w.args) as Row[];
    const lines = rows.map((r) => {
      const who = r.kind === 'audit' ? ` user=${r.username ?? (r.user_id ? `#${r.user_id}` : '-')} tenant=${r.tenant_id ?? '-'} ip=${r.ip ?? '-'}` : '';
      return `${r.ts} ${r.level.toUpperCase().padEnd(5)} [${r.source}] ${r.message}${who}`;
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="cyberpulse-logs-${stamp}.txt"`,
      'Cache-Control': 'no-store',
    }).send(lines.join('\n') + '\n');
  },
};

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { adminApi, logsApi, type LogEntry, type LogFilter, type LogLevel } from '@/services/hdApi';
import { locale, tr, useI18n } from '@/lib/i18n';
import { PageHeader, EmptyState } from './ui';
import { notifyError } from './helpers';

/* Superadmin: the application log (server lines + audit trail). Newest first,
   filterable, auto-refreshing, downloadable as text. */

const LEVELS: LogLevel[] = ['info', 'warn', 'error'];
const REFRESH_MS = 10_000;
const PAGE = 200;
const TZ = 'Europe/Madrid';

const levelCls: Record<LogLevel, string> = {
  info: 'text-text-tertiary border-border-default',
  warn: 'text-medium border-medium/40 bg-medium/10',
  error: 'text-critical border-critical/40 bg-critical/10',
};

const RANGES: Array<{ key: string; label: string; hours: number | null }> = [
  { key: '1h', label: '1H', hours: 1 },
  { key: '24h', label: '24H', hours: 24 },
  { key: '7d', label: '7 DAYS', hours: 24 * 7 },
  { key: 'all', label: 'ALL TIME', hours: null },
];

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium font-jetbrains uppercase tracking-[0.06em] transition-colors cursor-pointer ${
    active ? 'border-accent text-text-primary bg-accent/10' : 'border-border-default text-text-tertiary hover:border-text-tertiary'
  }`;

function fmtTs(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(locale(), { timeZone: TZ, day: '2-digit', month: '2-digit' });
  const time = d.toLocaleTimeString(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `${date} ${time}`;
}

export default function LogsTab() {
  useI18n();
  const [levels, setLevels] = useState<LogLevel[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [kind, setKind] = useState<'' | 'app' | 'audit'>('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [range, setRange] = useState('24h');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [allSources, setAllSources] = useState<Array<{ source: string; n: number }>>([]);
  const [tenants, setTenants] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const filter = useMemo<LogFilter>(() => {
    const hours = RANGES.find((r) => r.key === range)?.hours ?? null;
    return {
      level: levels,
      source: sources,
      kind,
      q: debounced,
      from: hours ? new Date(Date.now() - hours * 3600_000).toISOString() : undefined,
    };
    /* `range` recomputes "from" when it changes; auto-refresh only asks for newer rows. */
  }, [levels, sources, kind, debounced, range]);

  const newestId = entries[0]?.id;
  const filterRef = useRef(filter);

  const load = useCallback(async (f: LogFilter) => {
    setLoading(true);
    try {
      const r = await logsApi.list(f, { limit: PAGE });
      if (filterRef.current !== f) return;
      setEntries(r.entries);
      setHasMore(r.hasMore);
      setTotal(r.total);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    filterRef.current = filter;
    void load(filter);
  }, [filter, load]);

  useEffect(() => {
    logsApi.sources().then(setAllSources).catch(() => {});
    adminApi.list().then((ts) => setTenants(Object.fromEntries(ts.map((t) => [t.id, t.name])))).catch(() => {});
  }, []);

  /* Live: every 10 s fetch only rows newer than the newest one shown. */
  useEffect(() => {
    if (!live) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const f = filterRef.current;
      try {
        const r = await logsApi.list(f, newestId ? { after: newestId, limit: 500 } : { limit: PAGE });
        if (filterRef.current !== f || r.entries.length === 0) return;
        setEntries((prev) => [...r.entries, ...prev.filter((e) => !r.entries.some((n) => n.id === e.id))].slice(0, 5000));
        setTotal((n) => n + (newestId ? r.entries.length : 0));
      } catch { /* next tick */ }
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [live, newestId]);

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoading(true);
    try {
      const r = await logsApi.list(filter, { before: last.id, limit: PAGE });
      setEntries((prev) => [...prev, ...r.entries]);
      setHasMore(r.hasMore);
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const filtered = levels.length > 0 || sources.length > 0 || kind !== '' || query.trim() !== '' || range !== '24h';
  const reset = () => { setLevels([]); setSources([]); setKind(''); setQuery(''); setRange('24h'); };

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title={tr('Logs')}
        subtitle={tr('Server activity and audit trail of every change, kept for 14 days. Times in Madrid time. Secrets are masked before storing.')}
      />

      {/* Filters */}
      <div className="bg-bg-card border border-border-default rounded-xl p-3 mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('Search message, user or IP…')}
              aria-label={tr('Search logs')}
              className="w-full h-9 rounded-lg border border-border-default bg-bg-input pl-8 pr-8 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={tr('Clear search')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary cursor-pointer">
                <X size={14} />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" className="border-border-default bg-transparent" onClick={() => setLive(!live)} aria-pressed={live}>
            {live ? <Pause size={14} /> : <Play size={14} />} {live ? tr('Live') : tr('Paused')}
          </Button>
          <Button size="sm" variant="outline" className="border-border-default bg-transparent" onClick={() => void load(filter)} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {tr('Refresh')}
          </Button>
          <Button size="sm" variant="outline" className="border-border-default bg-transparent" asChild>
            <a href={logsApi.exportUrl(filter)} download><Download size={14} /> .txt</a>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {LEVELS.map((l) => (
            <button key={l} type="button" aria-pressed={levels.includes(l)} className={chip(levels.includes(l))} onClick={() => setLevels(toggle(levels, l))}>
              {tr(l === 'info' ? 'Info' : l === 'warn' ? 'Warning' : 'Error')}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border-default" />
          <button type="button" aria-pressed={kind === 'audit'} className={chip(kind === 'audit')} onClick={() => setKind(kind === 'audit' ? '' : 'audit')}>
            <ShieldCheck size={12} /> {tr('Audit only')}
          </button>
          <span className="mx-1 h-4 w-px bg-border-default" />
          {RANGES.map((r) => (
            <button key={r.key} type="button" aria-pressed={range === r.key} className={chip(range === r.key)} onClick={() => setRange(r.key)}>
              {tr(r.label)}
            </button>
          ))}
        </div>

        {allSources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-jetbrains uppercase tracking-[0.06em] text-text-tertiary mr-1">{tr('Source')}</span>
            {allSources.map((s) => (
              <button key={s.source} type="button" aria-pressed={sources.includes(s.source)} className={chip(sources.includes(s.source))} onClick={() => setSources(toggle(sources, s.source))}>
                {s.source} <span className="opacity-60">{s.n}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] font-jetbrains uppercase tracking-[0.06em] text-text-tertiary">
          <span data-testid="logs-count">{tr('{n} of {total}', { n: entries.length, total })}</span>
          {filtered && <button type="button" className="text-accent hover:underline cursor-pointer" onClick={reset}>{tr('Reset filters')}</button>}
        </div>
      </div>

      {/* Lines */}
      {entries.length === 0 && !loading ? (
        <EmptyState>{tr('No log lines match these filters.')}</EmptyState>
      ) : (
        <div className="bg-bg-card border border-border-default rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] font-jetbrains" data-testid="logs-table">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.06em] text-text-tertiary border-b border-border-default">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">{tr('Time')}</th>
                  <th className="px-2 py-2 font-medium">{tr('Level')}</th>
                  <th className="px-2 py-2 font-medium">{tr('Source')}</th>
                  <th className="px-2 py-2 font-medium w-full">{tr('Message')}</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">{tr('User · Company · IP')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const open = expanded === e.id;
                  return (
                    <tr
                      key={e.id}
                      onClick={() => setExpanded(open ? null : e.id)}
                      className={`border-b border-border-default/60 align-top cursor-pointer hover:bg-bg-elevated/50 ${e.level === 'error' ? 'bg-critical/[0.04]' : ''}`}
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap text-text-tertiary">{fmtTs(e.ts)}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block px-1.5 rounded border text-[10.5px] uppercase ${levelCls[e.level]}`}>{e.level}</span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <span className={e.kind === 'audit' ? 'text-accent' : 'text-text-secondary'}>{e.source}</span>
                      </td>
                      <td className={`px-2 py-1.5 text-text-primary min-w-[260px] md:min-w-0 ${open ? 'whitespace-pre-wrap break-all' : 'truncate max-w-0'}`} title={open ? undefined : e.message}>
                        {e.message}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-text-tertiary">
                        {e.kind === 'audit'
                          ? [e.username ?? (e.userId ? `#${e.userId}` : '—'), e.tenantId ? tenants[e.tenantId] ?? `#${e.tenantId}` : '—', e.ip ?? '—'].join(' · ')
                          : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <button type="button" onClick={() => void loadMore()} disabled={loading} className="w-full py-2.5 text-[11px] font-jetbrains uppercase tracking-[0.06em] text-accent hover:bg-bg-elevated cursor-pointer disabled:opacity-50">
              {tr('Load older lines')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Check, Layers, Search, X } from 'lucide-react';
import type { NewsArticle } from '@/data/mockNews';
import { timeAgo } from '@/lib/dateUtils';
import { tr, useI18n } from '@/lib/i18n';
import { timeRangeOptions, type TimeRange } from '@/lib/timeRange';
import { distinctSorted, filterArticles, isFiltered, SEVERITIES, type Severity } from '@/lib/articleFilter';

/* Searchable, filterable list used by the post generator, both to pick the
   single source article and to pick the articles of a Daily Digest. */

const STACK_PREF_KEY = 'cyberpulse.picker.stackOnly';
const PAGE = 150;

const severityDot: Record<Severity, string> = {
  critical: 'bg-[#EF4444]',
  high: 'bg-[#F97316]',
  medium: 'bg-[#EAB308]',
  low: 'bg-[#22C55E]',
};
const severityLabel: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export interface StackFilterSource {
  /* The user has an active company (otherwise there is no stack). */
  available: boolean;
  /* Ids of the articles that match the company stack; null until loaded. */
  ids: Set<string> | null;
  loading: boolean;
  load: () => void;
}

type Props = {
  articles: NewsArticle[];
  stack: StackFilterSource;
} & (
  | { mode: 'single'; selectedId: string; onSelect: (id: string) => void }
  | { mode: 'multi'; selectedIds: string[]; onChange: (ids: string[]) => void }
);

function readStackPref(): boolean {
  try {
    return localStorage.getItem(STACK_PREF_KEY) === '1';
  } catch {
    return false;
  }
}

const chip = (active: boolean) =>
  `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium font-jetbrains uppercase tracking-[0.06em] transition-colors cursor-pointer ${
    active
      ? 'border-[#E8533F] text-[#E6EDF3] bg-[rgba(232,83,63,0.12)]'
      : 'border-[#2A3140] text-[#8B949E] hover:border-[#636E7B]'
  }`;

const selectCls =
  'min-w-0 flex-1 bg-[#1A1F2E] border border-[#2A3140] rounded-lg h-8 px-2 text-[12px] font-inter text-[#E6EDF3] hover:border-[#636E7B] focus:outline-none focus:border-[#E8533F]';

export default function ArticlePicker(props: Props) {
  useI18n();
  const { articles, stack } = props;

  const [query, setQuery] = useState('');
  const [severities, setSeverities] = useState<Severity[]>([]);
  const [range, setRange] = useState<TimeRange>('all');
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [stackOnly, setStackOnlyState] = useState<boolean>(readStackPref);

  const stackActive = stackOnly && stack.available;
  const { load: loadStack, ids: stackIds, loading: stackLoading } = stack;
  useEffect(() => {
    if (stackActive && !stackIds && !stackLoading) loadStack();
  }, [stackActive, stackIds, stackLoading, loadStack]);

  const setStackOnly = (on: boolean) => {
    setStackOnlyState(on);
    try {
      localStorage.setItem(STACK_PREF_KEY, on ? '1' : '0');
    } catch {
      /* private mode: the toggle still works for this visit */
    }
  };

  const sources = useMemo(() => distinctSorted(articles, 'source'), [articles]);
  const categories = useMemo(() => distinctSorted(articles, 'category'), [articles]);

  const filter = useMemo(
    () => ({
      query,
      severities,
      range,
      source,
      category,
      /* While the stack is loading show nothing rather than everything. */
      stackIds: stackActive ? stackIds ?? new Set<string>() : null,
    }),
    [query, severities, range, source, category, stackActive, stackIds]
  );
  const visible = useMemo(() => filterArticles(articles, filter), [articles, filter]);
  const filtered = isFiltered(filter);

  /* "Show more" pages are per filter: changing a filter starts again at PAGE. */
  const [paging, setPaging] = useState<{ key: typeof filter; limit: number } | null>(null);
  const limit = paging?.key === filter ? paging.limit : PAGE;

  const clearFilters = () => {
    setQuery('');
    setSeverities([]);
    setRange('all');
    setSource('');
    setCategory('');
    setStackOnly(false);
  };

  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const isSelected = (id: string) =>
    props.mode === 'single' ? props.selectedId === id : props.selectedIds.includes(id);

  const onRow = (id: string) => {
    if (props.mode === 'single') props.onSelect(id);
    else props.onChange(isSelected(id) ? props.selectedIds.filter((x) => x !== id) : [...props.selectedIds, id]);
  };

  /* Single mode: the chosen article stays visible on top even when the
     filters would hide it, so the preview never points at an invisible row. */
  const pinned =
    props.mode === 'single' && props.selectedId && !visible.some((a) => a.id === props.selectedId)
      ? articles.find((a) => a.id === props.selectedId)
      : undefined;

  const shown = visible.slice(0, limit);

  return (
    <div className="mb-4 bg-[#161B22] border border-[#2A3140] rounded-xl overflow-hidden" data-testid="article-picker">
      {/* Filters */}
      <div className="p-3 border-b border-[#2A3140] space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#636E7B]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Search title, summary, source or CVE…')}
            aria-label={tr('Search articles')}
            className="w-full bg-[#1A1F2E] border border-[#2A3140] rounded-lg h-9 pl-8 pr-8 text-[13px] font-inter text-[#E6EDF3] placeholder:text-[#636E7B] hover:border-[#636E7B] focus:outline-none focus:border-[#E8533F]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={tr('Clear search')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#636E7B] hover:text-[#E6EDF3] cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={severities.includes(s)}
              onClick={() => toggleSeverity(s)}
              className={chip(severities.includes(s))}
            >
              <span className={`w-2 h-2 rounded-full ${severityDot[s]}`} />
              {tr(severityLabel[s])}
            </button>
          ))}
          {stack.available && (
            <button
              type="button"
              role="switch"
              aria-checked={stackOnly}
              onClick={() => setStackOnly(!stackOnly)}
              title={tr('Show only articles that match your company stack')}
              className={chip(stackOnly)}
            >
              <Layers size={12} />
              {tr('Only my stack')}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {timeRangeOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={range === o.key}
              onClick={() => setRange(o.key)}
              className={chip(range === o.key)}
            >
              {tr(o.label)}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={tr('Source')} className={selectCls}>
            <option value="">{tr('All sources')}</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={tr('Category')} className={selectCls}>
            <option value="">{tr('All categories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] font-medium font-jetbrains uppercase tracking-[0.06em] text-[#636E7B]">
          <span data-testid="picker-count">
            {visible.length} {tr('of')} {articles.length}
            {props.mode === 'multi' && (
              <span className="text-[#E8533F]">
                {' · '}
                {props.selectedIds.length} {tr('selected')}
              </span>
            )}
          </span>
          <span className="flex items-center gap-3">
            {props.mode === 'multi' && (
              <>
                <button
                  type="button"
                  disabled={visible.length === 0}
                  onClick={() => props.onChange([...new Set([...props.selectedIds, ...visible.map((a) => a.id)])])}
                  className="hover:text-[#E6EDF3] disabled:opacity-40 cursor-pointer"
                >
                  {tr('Select visible')}
                </button>
                <button
                  type="button"
                  disabled={props.selectedIds.length === 0}
                  onClick={() => props.onChange([])}
                  className="hover:text-[#E6EDF3] disabled:opacity-40 cursor-pointer"
                >
                  {tr('Clear selection')}
                </button>
              </>
            )}
            {filtered && (
              <button type="button" onClick={clearFilters} className="text-[#E8533F] hover:underline cursor-pointer">
                {tr('Reset filters')}
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Results */}
      <div className="max-h-[340px] overflow-y-auto" role="listbox" aria-multiselectable={props.mode === 'multi'}>
        {pinned && <Row article={pinned} selected multi={false} onClick={() => onRow(pinned.id)} note={tr('selected · hidden by filters')} />}
        {stackActive && !stackIds ? (
          <p className="px-4 py-6 text-center text-[13px] font-inter text-[#636E7B]">{tr('Loading your stack…')}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] font-inter text-[#636E7B]">
            {stackActive && stackIds && stackIds.size === 0
              ? tr('No articles match your stack yet.')
              : tr('No articles match these filters.')}
          </p>
        ) : (
          shown.map((a) => (
            <Row key={a.id} article={a} selected={isSelected(a.id)} multi={props.mode === 'multi'} onClick={() => onRow(a.id)} />
          ))
        )}
        {visible.length > shown.length && (
          <button
            type="button"
            onClick={() => setPaging({ key: filter, limit: limit + PAGE })}
            className="w-full py-2.5 text-[11px] font-medium font-jetbrains uppercase tracking-[0.06em] text-[#E8533F] hover:bg-[#1A1F2E] cursor-pointer"
          >
            {tr('Show more')} ({visible.length - shown.length})
          </button>
        )}
      </div>
    </div>
  );
}

function Row({
  article,
  selected,
  multi,
  onClick,
  note,
}: {
  article: NewsArticle;
  selected: boolean;
  multi: boolean;
  onClick: () => void;
  note?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 px-4 py-2.5 border-b border-[#1A1F2E] transition-colors hover:bg-[#1A1F2E] cursor-pointer ${
        selected ? 'bg-[rgba(232,83,63,0.08)]' : ''
      }`}
    >
      <span
        className={`mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center border ${multi ? 'rounded' : 'rounded-full'} ${
          selected ? 'bg-[#E8533F] border-[#E8533F]' : 'border-[#2A3140] bg-[#1A1F2E]'
        }`}
      >
        {selected && <Check size={11} className="text-white" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2 mb-0.5 text-[10px] font-medium font-jetbrains uppercase tracking-[0.06em] text-[#636E7B]">
          <span className={`w-2 h-2 rounded-full shrink-0 ${severityDot[article.severity] ?? 'bg-[#8B949E]'}`} />
          <span className="truncate">{article.source}</span>
          <span className="shrink-0">· {timeAgo(article.publishedAt)}</span>
          {note && <span className="shrink-0 text-[#E8533F]">· {note}</span>}
        </span>
        <span className="block text-[13px] font-inter text-[#E6EDF3] leading-[1.35] line-clamp-2">{article.title}</span>
      </span>
    </button>
  );
}

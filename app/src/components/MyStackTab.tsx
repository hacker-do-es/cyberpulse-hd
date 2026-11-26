import { useState, useMemo, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Clock, RefreshCw, ExternalLink, Thermometer, ChevronLeft, ChevronRight, Server, Building2, TrendingUp, ShieldAlert, ShieldCheck, ShieldQuestion, Hourglass } from 'lucide-react';
import type { AssetRef, TechStackNewsArticle, VulnStatus } from '@/services/apiService';
import { AssetChips } from './hd/AssetManager';
import { criticalityLabel } from './hd/assetLabels';
import { timeAgo } from '@/lib/dateUtils';
import { locale, tr, trMessage, useI18n } from '@/lib/i18n';

interface MyStackTabProps {
  articles: TechStackNewsArticle[];
  loading: boolean;
  refreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
  onSelectArticle: (id: string) => void;
  selectedArticleId: string | null;
  statistics: {
    totalArticles: number;
    matchedArticles: number;
    byTechnology: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  techStackCount: number;
  /* All-companies view (platform staff, no company picked): the companies
     whose stacks were matched. Adds a company filter and company chips. */
  companies?: Array<{ id: number; name: string }>;
}

type SortOption = 'score' | 'date' | 'severity';

/* Version verification filter: 'unverified' groups pending + unverified. */
type VulnFilter = 'all' | 'affected' | 'not_affected' | 'unverified' | 'no_cve';

function vulnGroup(status: VulnStatus | undefined): Exclude<VulnFilter, 'all'> {
  if (status === 'affected' || status === 'not_affected' || status === 'no_cve') return status;
  return 'unverified';
}

const VULN_FILTERS: { key: VulnFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'affected', label: 'Affects you (verified)' },
  { key: 'not_affected', label: 'Not affected' },
  { key: 'unverified', label: 'Unverified' },
  { key: 'no_cve', label: 'No CVE' },
];

const severityRank: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const severityColor: Record<string, string> = {
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low',
};

const sortOptions: { key: SortOption; label: string }[] = [
  { key: 'score', label: 'RELEVANCE' },
  { key: 'date', label: 'DATE' },
  { key: 'severity', label: 'SEVERITY' },
];

export default function MyStackTab({
  articles,
  loading,
  refreshing,
  lastUpdated,
  onRefresh,
  onSelectArticle,
  selectedArticleId,
  statistics,
  techStackCount,
  companies,
}: MyStackTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('score');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedTech, setSelectedTech] = useState<string[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<number[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<number[]>([]);
  const [vulnFilter, setVulnFilter] = useState<VulnFilter>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('cyberpulse.mystack.vuln') : null;
    return (VULN_FILTERS.some((f) => f.key === saved) ? saved : 'all') as VulnFilter;
  });

  useEffect(() => {
    localStorage.setItem('cyberpulse.mystack.vuln', vulnFilter);
  }, [vulnFilter]);

  /* The company filter narrows every other filter's options and counts. */
  const scoped = useMemo(
    () => (selectedCompanies.length > 0
      ? articles.filter((a) => (a.tenants ?? []).some((t) => selectedCompanies.includes(t.id)))
      : articles),
    [articles, selectedCompanies]
  );

  const vulnCounts = useMemo(() => {
    const c: Record<Exclude<VulnFilter, 'all'>, number> = { affected: 0, not_affected: 0, unverified: 0, no_cve: 0 };
    for (const a of scoped) c[vulnGroup(a.vuln?.status)]++;
    return c;
  }, [scoped]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchQuery), 180);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const categories = useMemo(
    () => Array.from(new Set(scoped.map((a) => a.category))).sort(),
    [scoped]
  );

  const technologies = useMemo(
    () => Array.from(new Set(scoped.flatMap((a) => a.matchedTechnologies))).sort(),
    [scoped]
  );
  const techCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of scoped) for (const t of a.matchedTechnologies) c[t] = (c[t] || 0) + 1;
    return c;
  }, [scoped]);

  /* Assets affected by at least one article, most critical first, with counts. */
  const affectedAssets = useMemo(() => {
    const byId = new Map<number, { asset: AssetRef; count: number }>();
    for (const a of scoped) {
      for (const asset of a.affectedAssets ?? []) {
        const e = byId.get(asset.id);
        if (e) e.count++;
        else byId.set(asset.id, { asset, count: 1 });
      }
    }
    const rank = { high: 2, medium: 1, low: 0 } as const;
    return Array.from(byId.values()).sort((x, y) => rank[y.asset.criticality] - rank[x.asset.criticality] || y.count - x.count);
  }, [scoped]);

  /* Companies with at least one matched article, most articles first. */
  const companyCounts = useMemo(() => {
    if (!companies) return [];
    const counts = new Map<number, number>();
    for (const a of articles) for (const t of a.tenants ?? []) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
    return companies
      .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }))
      .filter((c) => c.count > 0)
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  }, [articles, companies]);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...scoped];


    if (vulnFilter !== 'all') {
      filtered = filtered.filter((a) => vulnGroup(a.vuln?.status) === vulnFilter);
    }

    if (selectedAssets.length > 0) {
      filtered = filtered.filter((a) => (a.affectedAssets ?? []).some((as) => selectedAssets.includes(as.id)));
    }

    if (selectedCategories.length > 0) {
      filtered = filtered.filter((a) => selectedCategories.includes(a.category));
    }

    if (selectedTech.length > 0) {
      filtered = filtered.filter((a) =>
        a.matchedTechnologies.some((tech) => selectedTech.includes(tech))
      );
    }

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.summary.toLowerCase().includes(q) ||
          a.matchedTechnologies.some((tech) => tech.toLowerCase().includes(q)) ||
          (a.affectedAssets ?? []).some((as) => as.name.toLowerCase().includes(q)) ||
          (a.tenants ?? []).some((t) => t.name.toLowerCase().includes(q))
      );
    }

    const sorted = [...filtered];
    switch (sortBy) {
      case 'severity':
        sorted.sort((a, b) => severityRank[b.severity] - severityRank[a.severity]);
        break;
      case 'date':
        sorted.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        break;
      case 'score':
      default:
        sorted.sort((a, b) => b.matchScore - a.matchScore);
        break;
    }

    return sorted;
  }, [scoped, selectedCategories, selectedTech, selectedAssets, debouncedSearch, sortBy, vulnFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / pageSize));
  const startIndex = (page - 1) * pageSize;
  const paginatedArticles = filteredAndSorted.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    setPage(1);
  }, [selectedCategories, selectedTech, selectedAssets, selectedCompanies, debouncedSearch, sortBy, pageSize, vulnFilter]);

  if (techStackCount === 0 && companies && !loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <Building2 size={48} className="text-text-tertiary" />
        <p className="text-sm text-text-secondary font-inter max-w-md">
          {tr("No active company has technologies in its stack yet.")}
        </p>
      </div>
    );
  }

  if (techStackCount === 0 && !companies) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8 text-center">
        <Server size={48} className="text-text-tertiary" />
        <h3 className="text-lg font-semibold font-inter text-text-primary">
          {tr("Configure Your Tech Stack")}
        </h3>
        <p className="text-sm text-text-secondary font-inter max-w-md">
          {tr("Add your technologies (PHP, Apache, WordPress, etc.) in the Technologies tab to receive personalized security news relevant to your infrastructure.")}
        </p>
        <p className="text-xs text-text-tertiary font-jetbrains">
          {tr("Technologies → Import CSV or Add")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          <RefreshCw size={32} className="text-accent" />
        </motion.div>
        <p className="text-text-secondary text-sm font-inter font-medium">
          {tr("Analyzing articles for your tech stack...")}
        </p>
        <p className="text-text-tertiary text-xs font-jetbrains">
          {tr("Matching against")} {techStackCount} {techStackCount === 1 ? 'technology' : 'technologies'}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full">
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="px-4 py-3 rounded-card bg-bg-card border border-border-default">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={16} className="text-accent" />
            <span className="text-xs font-jetbrains uppercase tracking-wide text-text-tertiary">
              {tr("Matched Articles")}
            </span>
          </div>
          <p className="text-2xl font-bold font-inter text-text-primary">
            {statistics.matchedArticles}
          </p>
          <p className="text-xs text-text-tertiary font-jetbrains mt-1">
            {tr("from")} {statistics.totalArticles} {tr("total")}
          </p>
        </div>

        <div className="px-4 py-3 rounded-card bg-bg-card border border-border-default">
          <div className="flex items-center gap-2 mb-1">
            <Server size={16} className="text-accent" />
            <span className="text-xs font-jetbrains uppercase tracking-wide text-text-tertiary">
              {tr("Technologies")}
            </span>
          </div>
          <p className="text-2xl font-bold font-inter text-text-primary">
            {Object.keys(statistics.byTechnology).length}
          </p>
          <p className="text-xs text-text-tertiary font-jetbrains mt-1">
            {tr("in your stack")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setVulnFilter(vulnFilter === 'affected' ? 'all' : 'affected')}
          className={`text-left px-4 py-3 rounded-card bg-bg-card border cursor-pointer transition-colors ${vulnFilter === 'affected' ? 'border-critical' : 'border-border-default hover:border-[#30384A]'}`}
          title={tr('CVEs whose affected versions include a version installed on your assets')}
        >
          <div className="flex items-center gap-2 mb-1">
            <ShieldAlert size={16} className="text-critical" />
            <span className="text-xs font-jetbrains uppercase tracking-wide text-text-tertiary">
              {tr("Confirmed vulnerabilities")}
            </span>
          </div>
          <p className="text-2xl font-bold font-inter text-text-primary">
            {vulnCounts.affected}
          </p>
          <p className="text-xs text-text-tertiary font-jetbrains mt-1">
            {tr('{n} not affected · {u} unverified', { n: vulnCounts.not_affected, u: vulnCounts.unverified })}
          </p>
        </button>
      </div>

      {/* Controls Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {sortOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setSortBy(option.key)}
                className={`
                  px-3 py-1.5 text-[13px] font-medium font-inter rounded-md
                  transition-all duration-200 cursor-pointer
                  ${sortBy === option.key
                    ? 'text-accent bg-accent-dim'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
                  }
                `}
              >
                {tr(option.label)}
              </button>
            ))}
          </div>

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium font-inter rounded-md text-accent bg-accent-dim hover:brightness-110 transition-all cursor-pointer disabled:opacity-50"
            title={lastUpdated ? tr('Last updated: {time}', { time: lastUpdated.toLocaleTimeString(locale()) }) : tr('Refresh')}
          >
            <motion.span
              animate={refreshing ? { rotate: 360 } : { rotate: 0 }}
              transition={refreshing ? { duration: 1, repeat: Infinity, ease: 'linear' } : {}}
            >
              <RefreshCw size={14} />
            </motion.span>
            {refreshing ? tr('Updating...') : tr('Refresh')}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[11px] font-jetbrains text-text-tertiary">
              {tr("Updated")} {lastUpdated.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <div className="relative w-full sm:w-60">
            <Search
              size={16}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none"
            />
            <input
              type="text"
              placeholder={tr("Search articles...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`
                w-full pl-10 pr-4 py-2.5 bg-bg-input
                border border-border-default rounded-input
                text-sm text-text-primary font-inter
                placeholder:text-text-tertiary
                focus:outline-none focus:border-accent
                focus:shadow-[0_0_0_2px_rgba(232, 83, 63,0.15)]
                transition-all duration-200
              `}
            />
          </div>
        </div>
      </div>

      {/* Version verification filter */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mr-1">
          {tr("Verification")}
        </span>
        {VULN_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setVulnFilter(key)}
            className={`px-2.5 py-1 text-[11px] font-medium font-inter rounded-md transition-all duration-200 cursor-pointer ${vulnFilter === key ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
          >
            {tr(label)}
            {key !== 'all' && <span className="text-text-tertiary ml-1">({vulnCounts[key]})</span>}
          </button>
        ))}
      </div>

      {/* Technology filters */}
      {technologies.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mr-1">
            {tr("Technologies")}
          </span>
          <button
            onClick={() => setSelectedTech([])}
            className={`
              px-2.5 py-1 text-[11px] font-medium font-inter rounded-md
              transition-all duration-200 cursor-pointer
              ${selectedTech.length === 0
                ? 'text-accent bg-accent-dim'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
              }
            `}
          >
            {tr("All")}
          </button>
          {technologies.slice(0, 10).map((tech) => {
            const active = selectedTech.includes(tech);
            const count = techCounts[tech] || 0;
            return (
              <button
                key={tech}
                onClick={() =>
                  setSelectedTech((prev) =>
                    active ? prev.filter((t) => t !== tech) : [...prev, tech]
                  )
                }
                className={`
                  px-2.5 py-1 text-[11px] font-medium font-inter rounded-md
                  transition-all duration-200 cursor-pointer
                  ${active
                    ? 'text-accent bg-accent-dim'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
                  }
                `}
              >
                {tech} <span className="text-text-tertiary ml-1">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Company filters (all-companies view) */}
      {companies && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mr-1">
            {tr("Companies")}
          </span>
          <button
            onClick={() => setSelectedCompanies([])}
            className={`px-2.5 py-1 text-[11px] font-medium font-inter rounded-md transition-all duration-200 cursor-pointer ${selectedCompanies.length === 0 ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
          >
            {tr("All")} <span className="text-text-tertiary ml-1">({companies.length})</span>
          </button>
          {companyCounts.map((c) => {
            const active = selectedCompanies.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCompanies((prev) => (active ? prev.filter((id) => id !== c.id) : [...prev, c.id]))}
                className={`px-2.5 py-1 text-[11px] font-medium font-jetbrains rounded-md transition-all duration-200 cursor-pointer ${active ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
              >
                <Building2 size={11} className="inline mr-1 -mt-0.5" />
                {c.name} <span className="text-text-tertiary ml-1">({c.count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Affected asset filters */}
      {affectedAssets.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mr-1">
            {tr("Assets")}
          </span>
          <button
            onClick={() => setSelectedAssets([])}
            className={`px-2.5 py-1 text-[11px] font-medium font-inter rounded-md transition-all duration-200 cursor-pointer ${selectedAssets.length === 0 ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
          >
            {tr("All")}
          </button>
          {affectedAssets.slice(0, 12).map(({ asset, count }) => {
            const active = selectedAssets.includes(asset.id);
            return (
              <button
                key={asset.id}
                title={criticalityLabel(asset.criticality)}
                onClick={() => setSelectedAssets((prev) => (active ? prev.filter((id) => id !== asset.id) : [...prev, asset.id]))}
                className={`px-2.5 py-1 text-[11px] font-medium font-jetbrains rounded-md transition-all duration-200 cursor-pointer ${active ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${asset.criticality === 'high' ? 'bg-critical' : asset.criticality === 'medium' ? 'bg-medium' : 'bg-text-tertiary'}`} />
                {asset.name} <span className="text-text-tertiary ml-1">({count})</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Category filters */}
      {categories.length > 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-[#636E7B] mr-1">
            {tr("Categories")}
          </span>
          <button
            onClick={() => setSelectedCategories([])}
            className={`
              px-2.5 py-1 text-[11px] font-medium font-inter rounded-md
              transition-all duration-200 cursor-pointer
              ${selectedCategories.length === 0
                ? 'text-accent bg-accent-dim'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
              }
            `}
          >
            {tr("All")}
          </button>
          {categories.map((category) => {
            const active = selectedCategories.includes(category);
            return (
              <button
                key={category}
                onClick={() =>
                  setSelectedCategories((prev) =>
                    active ? prev.filter((c) => c !== category) : [...prev, category]
                  )
                }
                className={`
                  px-2.5 py-1 text-[11px] font-medium font-inter rounded-md
                  transition-all duration-200 cursor-pointer
                  ${active
                    ? 'text-accent bg-accent-dim'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'
                  }
                `}
              >
                {tr(category)}
              </button>
            );
          })}
        </div>
      )}

      {/* Article count */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[11px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary">
          {filteredAndSorted.length === 0
            ? '0 articles'
            : tr('{from}-{to} of {total} articles', { from: startIndex + 1, to: Math.min(startIndex + pageSize, filteredAndSorted.length), total: filteredAndSorted.length })}
        </span>
        {refreshing && (
          <span className="text-[11px] font-jetbrains text-accent animate-pulse">
            {tr("Refreshing...")}
          </span>
        )}
      </div>

      {/* News Cards Grid */}
      <motion.div
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: {
            transition: {
              staggerChildren: 0.05,
            },
          },
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {paginatedArticles.map((article) => (
            <StackNewsCard
              key={article.id}
              article={article}
              isSelected={selectedArticleId === article.id}
              onClick={() => onSelectArticle(article.id)}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      {filteredAndSorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-text-secondary text-sm font-inter">
            {tr("No articles match your filters")}
          </p>
        </div>
      )}

      {/* Pagination */}
      {filteredAndSorted.length > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              aria-label={tr("Previous page")}
            >
              <ChevronLeft size={18} />
            </button>
            <span className="text-[11px] font-medium font-jetbrains text-text-secondary min-w-[90px] text-center">
              {tr("Page")} {page} {tr("of")} {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-elevated disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              aria-label={tr("Next page")}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-jetbrains text-text-tertiary">{tr("Show")}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="bg-bg-input border border-border-default text-text-primary text-[11px] font-jetbrains rounded-md px-2 py-1 focus:outline-none focus:border-accent"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Stack News Card ─── */

interface StackNewsCardProps {
  article: TechStackNewsArticle;
  isSelected: boolean;
  onClick: () => void;
}

const StackNewsCard = memo(function StackNewsCard({ article, isSelected, onClick }: StackNewsCardProps) {
  useI18n();
  const dotColor = severityColor[article.severity] || 'bg-medium';

  return (
    <motion.article
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0 },
      }}
      exit={{ opacity: 0, transition: { duration: 0.14, ease: 'easeOut' } }}
      transition={{
        duration: 0.24,
        ease: [0, 0, 0.2, 1] as [number, number, number, number],
        layout: { duration: 0.26, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
      }}
      layout
      onClick={onClick}
      className={`
        relative p-4 rounded-card bg-bg-card border cursor-pointer
        transition-all duration-200 ease-out
        ${isSelected
          ? 'border-accent border-l-[3px] shadow-accent-glow'
          : 'border-border-default hover:border-[#30384A] hover:bg-bg-elevated'
        }
      `}
    >
      {/* Match Score Badge */}
      <div className="absolute top-3 right-3">
        <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-dim text-accent text-[10px] font-bold font-jetbrains uppercase tracking-wide rounded-pill">
          <Thermometer size={10} />
          {Math.round(article.matchScore)}
        </span>
      </div>

      {/* Row 1: Header */}
      <div className="flex items-center gap-2 mb-2 pr-16">
        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
        <span className="flex-1 text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-text-tertiary truncate">
          {article.source}
        </span>
        <span className="text-[11px] font-medium font-jetbrains text-text-tertiary shrink-0">
          {timeAgo(article.publishedAtIso ?? article.publishedAt)}
        </span>
      </div>

      {/* Row 2: Title */}
      <h3 className="text-base font-semibold font-inter leading-snug tracking-tight line-clamp-2 mb-1">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={tr("Read the original article")}
          className="text-text-primary hover:text-accent hover:underline decoration-1 underline-offset-2 transition-colors"
        >
          {article.title}
        </a>
      </h3>

      {/* Row 3: Matched Technologies */}
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        {article.matchedTechnologies.slice(0, 3).map((tech) => (
          <span
            key={tech}
            className="inline-flex items-center px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-medium font-jetbrains uppercase tracking-wide rounded-pill"
          >
            {tech}
          </span>
        ))}
        {article.matchedTechnologies.length > 3 && (
          <span className="text-[10px] font-jetbrains text-text-tertiary">
            +{article.matchedTechnologies.length - 3} {tr("more")}
          </span>
        )}
      </div>

      {/* Row 3a: Companies (all-companies view) */}
      {(article.tenants?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[10px] font-jetbrains uppercase tracking-wide text-text-tertiary">{tr("Companies")}</span>
          {article.tenants!.map((t) => (
            <span
              key={t.id}
              title={tr(VULN_STYLE[t.status].label)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border text-[10px] font-medium font-jetbrains ${t.status === 'affected' ? VULN_STYLE.affected.cls : 'bg-bg-elevated text-text-secondary border-border-default'}`}
            >
              <Building2 size={10} />
              {t.name}
            </span>
          ))}
        </div>
      )}

      {/* Row 3b: Affected assets */}
      {(article.affectedAssets?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-[10px] font-jetbrains uppercase tracking-wide text-text-tertiary">{tr("Affects")}</span>
          <AssetChips assets={article.affectedAssets} max={5} />
        </div>
      )}

      <VulnBlock article={article} />

      {/* Row 4: Summary */}
      <p className="text-sm text-text-secondary font-inter leading-relaxed line-clamp-2 mb-3">
        {article.summary}
      </p>

      {/* Row 5: Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-1 bg-accent-dim text-accent text-[11px] font-medium font-jetbrains uppercase tracking-wide rounded-pill">
            {tr(article.category)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title={tr("Open original article")}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[11px] font-medium font-jetbrains text-accent hover:text-accent/80 transition-colors"
          >
            <ExternalLink size={12} />
            {tr("Source")}
          </a>
          <span className="flex items-center gap-1.5 text-[11px] font-medium font-jetbrains text-text-tertiary">
            <Clock size={12} />
            {trMessage(article.readTime)}
          </span>
        </div>
      </div>
    </motion.article>
  );
});

/* ─── Version verdict ─── */

const VULN_STYLE: Record<VulnStatus, { cls: string; label: string; icon: typeof ShieldAlert }> = {
  affected: { cls: 'bg-critical/15 text-critical border-critical/40', label: 'Affects you', icon: ShieldAlert },
  not_affected: { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'Not affected', icon: ShieldCheck },
  pending: { cls: 'bg-bg-elevated text-text-tertiary border-border-default', label: 'Checking CVE…', icon: Hourglass },
  unverified: { cls: 'bg-medium/10 text-medium border-medium/30', label: 'Unverified', icon: ShieldQuestion },
  no_cve: { cls: 'bg-bg-elevated text-text-tertiary border-border-default', label: 'No CVE', icon: ShieldQuestion },
};

function VulnBlock({ article }: { article: TechStackNewsArticle }) {
  const v = article.vuln;
  if (!v) return null;
  const style = VULN_STYLE[v.status];
  const Icon = style.icon;
  const assetName = new Map((article.affectedAssets ?? []).map((a) => [a.id, a.name]));
  const affected = v.units.filter((u) => u.status === 'affected');
  const noVersion = v.units.filter((u) => u.status === 'no_version');
  const why = v.status === 'not_affected'
    ? v.units
      .filter((u) => u.status === 'not_affected')
      .slice(0, 3)
      .map((u) => `${u.technology} ${u.version ?? ''}${u.assetId !== null && assetName.has(u.assetId) ? ` (${assetName.get(u.assetId)})` : ''}`.trim())
      .join(', ')
    : '';
  const title = v.status === 'not_affected'
    ? (why ? tr('Installed versions are outside the affected ranges: {list}', { list: why }) : tr('The CVE is about other products'))
    : v.status === 'unverified'
      ? (noVersion.length ? tr('Add the installed version of {tech} to verify it', { tech: Array.from(new Set(noVersion.map((u) => u.technology))).join(', ') }) : tr('The CVE data does not allow a decision for these versions'))
      : '';

  return (
    <div className="mb-2 flex items-start gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <span title={title || undefined} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border text-[10px] font-semibold font-jetbrains uppercase tracking-wide ${style.cls}`}>
        <Icon size={11} />
        {tr(style.label)}
      </span>
      {v.cves.slice(0, 3).map((c) => (
        <a
          key={c}
          href={`https://www.cve.org/CVERecord?id=${c}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-jetbrains text-text-tertiary hover:text-accent underline-offset-2 hover:underline"
        >
          {c}
        </a>
      ))}
      {v.cves.length > 3 && <span className="text-[10px] font-jetbrains text-text-tertiary">+{v.cves.length - 3}</span>}
      {affected.length > 0 && (
        <div className="basis-full flex flex-col gap-0.5 mt-1">
          {affected.slice(0, 4).map((u, i) => (
            <span key={i} className="text-[11px] font-jetbrains text-text-secondary">
              <span className="text-critical">●</span> {u.technology} {u.version}
              {u.assetId !== null && assetName.has(u.assetId) && <> · {assetName.get(u.assetId)}</>}
              {u.fixedIn && <span className="text-text-tertiary"> → {tr('fixed in {v}', { v: u.fixedIn })}</span>}
            </span>
          ))}
          {affected.length > 4 && <span className="text-[10px] font-jetbrains text-text-tertiary">+{affected.length - 4}</span>}
        </div>
      )}
      {v.status !== 'affected' && title && <span className="basis-full text-[11px] text-text-tertiary">{title}</span>}
    </div>
  );
}

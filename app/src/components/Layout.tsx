import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TabId } from './Navbar';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import NewsFeedTab from './NewsFeedTab';
import MyStackTab from './MyStackTab';

/* Only the news feed is needed to paint the first screen. The generator is
   the biggest component in the app and the history tab is rarely the landing
   view, so both load on demand. */
const GeneratePostTab = lazy(() => import('./GeneratePostTab'));
const HistoryTab = lazy(() => import('./HistoryTab'));
const LogsTab = lazy(() => import('./hd/LogsTab'));
import type { SourceInfo } from '@/hooks/useRSSFeeds';
import { Menu, LogOut, UserCog, Building2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { tabsForRole } from './Navbar';
import ChannelsTab from './hd/ChannelsTab';
import SettingsTab from './hd/SettingsTab';
import { AssetsTab, TechnologiesTab } from './hd/InventoryTabs';
import AdminTab from './hd/AdminTab';
import AccountDialog from './hd/AccountDialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRSSFeeds } from '@/hooks/useRSSFeeds';
import { countArticlesBySource, type TimeRange } from '@/lib/timeRange';
import { createSource, deleteSource, fetchTechStackNews, fetchTechStack, type TechStackNewsArticle } from '@/services/apiService';
import { LanguageToggle, tr, useI18n } from '@/lib/i18n';
import { toast } from 'sonner';
import { LinkedInPublishDialog } from './hd/LinkedIn';
import { takeDraft, useLinkedInStatus } from './hd/linkedinHelpers';

function TabLoading() {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="text-[11px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary">
        {tr("Loading…")}
      </span>
    </div>
  );
}

const tabContentVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

function NeedsCompany({ onPick }: { onPick: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3">
      <Building2 size={28} className="text-accent" />
      <p className="text-text-secondary text-sm max-w-sm">{tr("Pick a company in the selector at the top right (or in Companies) to see its stack, channels and settings.")}</p>
      <button onClick={onPick} className="text-accent text-sm hover:underline cursor-pointer">{tr("Go to Companies")}</button>
    </div>
  );
}

export default function Layout() {
  const { me, logout, switchTenant } = useAuth();
  /* Subscribes the whole shell to language changes: every screen below re-renders with it. */
  useI18n();
  const role = me?.user.role;
  const hasTenant = Boolean(me?.activeTenant);
  const [accountOpen, setAccountOpen] = useState(false);
  const [activeTab, setActiveTabRaw] = useState<TabId>(role === 'superadmin' && !hasTenant ? 'admin' : 'news');
  const setActiveTab = useCallback((t: TabId) => {
    setActiveTabRaw(tabsForRole(role).includes(t) ? t : 'news');
  }, [role]);
  const { articles, sources, loading, refreshing, syncing, lastUpdated, lastSyncResult, refresh, forceReload, reloadSources, syncFeeds } = useRSSFeeds();
  const [localSources, setLocalSources] = useState<SourceInfo[]>(sources);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /* Back from LinkedIn's consent screen (?linkedin=connected|error): report it,
     return to where the user started and offer to publish a kept draft. */
  const linkedin = useLinkedInStatus();
  const [pendingPost, setPendingPost] = useState<string | null>(null);
  const [linkedinReturn] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    const result = q.get('linkedin');
    if (!result) return null;
    window.history.replaceState(null, '', window.location.pathname);
    return { result, reason: q.get('reason'), view: q.get('view') };
  });
  useEffect(() => {
    if (!linkedinReturn) return;
    const { result, reason, view } = linkedinReturn;
    if (result === 'connected') {
      toast.success(tr('LinkedIn connected'));
      void linkedin.reload();
      if (view === 'account') setAccountOpen(true);
      else {
        setActiveTab('generate');
        const draft = takeDraft();
        if (draft) setPendingPost(draft);
      }
    } else {
      toast.error(reason === 'cancelled' ? tr('LinkedIn connection cancelled')
        : reason === 'expired' ? tr('The LinkedIn sign-in took too long. Try again.')
          : reason === 'scope' ? tr('LinkedIn did not grant permission to publish. Try again and accept all permissions.')
            : tr('Could not connect LinkedIn. Try again.'));
      if (view === 'account') setAccountOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedinReturn]);
  /* Lives here rather than in NewsFeedTab so the sidebar counts describe the
     same window the feed is showing. */
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  // Tech Stack state
  const [stackNews, setStackNews] = useState<TechStackNewsArticle[]>([]);
  const [stackStatistics, setStackStatistics] = useState({
    totalArticles: 0,
    matchedArticles: 0,
    byTechnology: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
  });
  const [techStackCount, setTechStackCount] = useState(0);
  const [loadingStack, setLoadingStack] = useState(false);
  const [refreshingStack, setRefreshingStack] = useState(false);
  const [stackLastUpdated, setStackLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (sources.length === 0) return;

    setLocalSources((prev) => {
      if (prev.length === 0) return sources;

      const prevMap = new Map(prev.map((s) => [s.name, s.active]));
      return sources.map((s) => ({
        ...s,
        active: prevMap.has(s.name) ? prevMap.get(s.name)! : s.active,
      }));
    });
  }, [sources]);

  const handleToggleSource = useCallback((id: string) => {
    setLocalSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active } : s))
    );
  }, []);

  const handleToggleAllSources = useCallback((active: boolean) => {
    setLocalSources((prev) =>
      prev.map((s) => ({ ...s, active }))
    );
  }, []);

  const handleAddSource = useCallback(async (name: string, rssUrl: string, category: string) => {
    await createSource({ name, rssUrl, category });
    await reloadSources();
  }, [reloadSources]);

  const handleDeleteSource = useCallback(async (id: string) => {
    await deleteSource(id);
    await reloadSources();
  }, [reloadSources]);

  const effectiveSources = localSources.length > 0 ? localSources : sources;

  /* Replace the database-wide lifetime count with what is actually visible in
     the current window, and keep the lifetime figure so a source that has
     never produced anything can be told apart from one that is merely quiet. */
  const sourcesForSidebar = useMemo(() => {
    const windowCounts = countArticlesBySource(articles, timeRange);
    return effectiveSources.map((s) => ({
      ...s,
      count: windowCounts.get(s.name) ?? 0,
      lifetimeCount: s.count,
      neverDelivered: s.count === 0,
    }));
  }, [effectiveSources, articles, timeRange]);

  const handleSelectArticle = useCallback((id: string) => {
    setSelectedArticleId(id);
    setActiveTab('generate');
  }, []);

  const loadStackNews = useCallback(async () => {
    setLoadingStack(true);
    try {
      const [newsData, stackData] = await Promise.all([
        fetchTechStackNews(),
        fetchTechStack(),
      ]);
      setStackNews(newsData.news);
      setStackStatistics(newsData.statistics);
      setTechStackCount(stackData.length);
      setStackLastUpdated(new Date());
    } catch (err) {
      console.error('[Layout] Failed to load tech stack news:', err);
    } finally {
      setLoadingStack(false);
    }
  }, []);

  const refreshStackNews = useCallback(async () => {
    setRefreshingStack(true);
    try {
      const [newsData, stackData] = await Promise.all([
        fetchTechStackNews(),
        fetchTechStack(),
      ]);
      setStackNews(newsData.news);
      setStackStatistics(newsData.statistics);
      setTechStackCount(stackData.length);
      setStackLastUpdated(new Date());
    } catch (err) {
      console.error('[Layout] Failed to refresh tech stack news:', err);
    } finally {
      setRefreshingStack(false);
    }
  }, []);

  /* Another company's matches must not leak into the picker after a switch. */
  useEffect(() => {
    setStackLastUpdated(null);
    setStackNews([]);
  }, [me?.activeTenant?.id]);

  /* "Only my stack" filter in the post generator: loaded on demand. */
  const stackIds = useMemo(
    () => (stackLastUpdated ? new Set(stackNews.map((a) => a.id)) : null),
    [stackNews, stackLastUpdated]
  );
  const pickerStack = useMemo(
    () => ({ available: hasTenant, ids: stackIds, loading: loadingStack || refreshingStack, load: loadStackNews }),
    [hasTenant, stackIds, loadingStack, refreshingStack, loadStackNews]
  );

  // Load tech stack news on mount and when switching to my-stack tab
  useEffect(() => {
    if (activeTab === 'my-stack' && hasTenant) {
      loadStackNews();
    }
  }, [activeTab, loadStackNews, hasTenant, me?.activeTenant?.id]);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'news':
        return (
          <NewsFeedTab
            key="news"
            articles={articles}
            loading={loading}
            refreshing={refreshing}
            syncing={syncing}
            lastUpdated={lastUpdated}
            lastSyncResult={lastSyncResult}
            onRefresh={refresh}
            onForceReload={forceReload}
            onSyncFeeds={role === 'superadmin' ? syncFeeds : undefined}
            activeSources={effectiveSources
              .filter((s) => s.active)
              .map((s) => s.name)}
            onSelectArticle={handleSelectArticle}
            selectedArticleId={selectedArticleId}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        );
      case 'my-stack':
        if (!hasTenant) return <NeedsCompany onPick={() => setActiveTab('admin')} />;
        return (
          <MyStackTab
            key="my-stack"
            articles={stackNews}
            loading={loadingStack}
            refreshing={refreshingStack}
            lastUpdated={stackLastUpdated}
            onRefresh={refreshStackNews}
            onSelectArticle={handleSelectArticle}
            selectedArticleId={selectedArticleId}
            statistics={stackStatistics}
            techStackCount={techStackCount}
          />
        );
      case 'generate':
        return (
          <Suspense key="generate" fallback={<TabLoading />}>
            <GeneratePostTab
              articles={articles}
              selectedArticleId={selectedArticleId}
              onBackToNewsFeed={() => setActiveTab('news')}
              aiAvailable={Boolean(me?.activeTenant?.aiConfigured)}
              stack={pickerStack}
            />
          </Suspense>
        );
      case 'history':
        return (
          <Suspense key="history" fallback={<TabLoading />}>
            <HistoryTab />
          </Suspense>
        );
      case 'channels':
        if (!hasTenant) return <NeedsCompany onPick={() => setActiveTab('admin')} />;
        return <ChannelsTab key={`channels-${me?.activeTenant?.id}`} />;
      case 'technologies':
        if (!hasTenant) return <NeedsCompany onPick={() => setActiveTab('admin')} />;
        return <TechnologiesTab key={`tech-${me?.activeTenant?.id}`} onChanged={refreshStackNews} />;
      case 'assets':
        if (!hasTenant) return <NeedsCompany onPick={() => setActiveTab('admin')} />;
        return <AssetsTab key={`assets-${me?.activeTenant?.id}`} onChanged={refreshStackNews} />;
      case 'settings':
        if (!hasTenant) return <NeedsCompany onPick={() => setActiveTab('admin')} />;
        return <SettingsTab key={`settings-${me?.activeTenant?.id}`} />;
      case 'admin':
        return <AdminTab onEnterTenant={() => setActiveTab('technologies')} />;
      case 'logs':
        if (role !== 'superadmin') return null;
        return (
          <Suspense key="logs" fallback={<TabLoading />}>
            <LogsTab />
          </Suspense>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-bg-primary relative">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - responsive: hidden on mobile, drawer on tablet, fixed on desktop */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-40 w-[260px] h-full shrink-0
          transition-transform duration-300 ease-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        <Sidebar
          sources={sourcesForSidebar}
          onToggleSource={handleToggleSource}
          onToggleAll={handleToggleAllSources}
          onClose={() => setSidebarOpen(false)}
          onAddSource={role === 'superadmin' ? handleAddSource : undefined}
          onDeleteSource={role === 'superadmin' ? handleDeleteSource : undefined}
        />
      </aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top Navigation with hamburger */}
        <div className="flex items-center h-14 px-4 lg:px-6 bg-bg-primary border-b border-border-default shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-3 p-2 -ml-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer"
            aria-label={tr("Open menu")}
          >
            <Menu size={20} />
          </button>
          <Navbar activeTab={activeTab} onTabChange={setActiveTab} role={role} />
          <div className="ml-auto flex items-center gap-2 pl-3 shrink-0">
            {role === 'superadmin' ? (
              <select
                aria-label={tr("Active company")}
                value={me?.activeTenant?.id ?? ''}
                onChange={(e) => { void switchTenant(e.target.value ? Number(e.target.value) : null); }}
                className="h-8 max-w-[180px] rounded-md border border-border-default bg-bg-input px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">{tr("— No company —")}</option>
                {me?.tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (disabled)'}</option>
                ))}
              </select>
            ) : (
              <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-text-secondary font-rajdhani font-semibold tracking-wide">
                <Building2 size={14} className="text-accent" /> {me?.activeTenant?.name}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-1.5 h-8 px-2 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer">
                <span className="w-6 h-6 rounded-full bg-accent/15 text-accent font-semibold flex items-center justify-center uppercase">
                  {(me?.user.displayName || me?.user.username || '?').slice(0, 1)}
                </span>
                <span className="hidden sm:inline max-w-[110px] truncate">{me?.user.username}</span>
                <ChevronDown size={12} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-bg-card border-border-default text-text-primary">
                <DropdownMenuLabel className="text-xs text-text-tertiary font-normal">
                  {me?.user.role === 'superadmin' ? tr('Hacker-Do superadmin') : me?.user.role === 'admin' ? tr('Company admin') : tr('Member')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border-default" />
                <DropdownMenuItem onClick={() => setAccountOpen(true)} className="cursor-pointer"><UserCog size={14} /> {tr("My account")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => void logout()} className="cursor-pointer"><LogOut size={14} /> {tr("Sign out")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <LanguageToggle />
          </div>
          <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
          <LinkedInPublishDialog text={pendingPost ?? ''} open={pendingPost !== null} onClose={() => setPendingPost(null)}
            status={linkedin.status} onStatusChange={() => void linkedin.reload()} />
        </div>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={tabContentVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{
                duration: 0.25,
                ease: [0, 0, 0.2, 1] as [number, number, number, number],
              }}
              className="h-full"
            >
              {renderTabContent()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

import { useCan } from '@/lib/auth';
import { useCallback, useEffect, useState } from 'react';
import { Building2, Check, Clock, ExternalLink, Linkedin, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { linkedinApi, linkedinQueueApi, type QueuedPost, type QueueStatus } from '@/services/hdApi';
import { tr, useI18n } from '@/lib/i18n';
import { Badge, EmptyState, Panel } from './ui';
import { formatDateTime, inputCls, notifyError } from './helpers';
import { authorOptions, pickAuthor, rememberAuthor, stashDraft, toLinkedInText, useLinkedInStatus } from './linkedinHelpers';

/* The company's LinkedIn publishing queue (Channels tab) and the "Schedule"
   panel of Generate Post, both backed by /api/linkedin/queue. */

const STATUS_TONE: Record<QueueStatus, 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'> = {
  pending: 'warn', scheduled: 'accent', publishing: 'accent', published: 'ok', failed: 'bad', rejected: 'neutral', cancelled: 'neutral',
};
const STATUS_LABEL: Record<QueueStatus, string> = {
  pending: 'Waiting for approval', scheduled: 'Scheduled', publishing: 'Publishing', published: 'Published',
  failed: 'Failed', rejected: 'Rejected', cancelled: 'Cancelled',
};

/* UTC 'YYYY-MM-DD HH:MM:SS' → ISO for display helpers. */
const sqlToIso = (s: string | null) => (s ? `${s.replace(' ', 'T')}Z` : null);

/* datetime-local value (viewer's time) → ISO UTC. */
const localToIso = (v: string) => new Date(v).toISOString();
const isoToLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function AuthorLine({ p }: { p: QueuedPost }) {
  const page = p.author !== 'member';
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
      {page ? <Building2 size={12} className="text-[#0A66C2]" /> : <Linkedin size={12} className="text-[#0A66C2]" />}
      {p.authorLabel ?? (page ? p.author : p.authorUser ?? 'LinkedIn')}
    </span>
  );
}

function PostEditor({ post, mode, onClose, onDone }: {
  post: QueuedPost | null;
  mode: 'approve' | 'edit';
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!post) return;
    setText(post.text);
    setWhen(post.status === 'scheduled' ? isoToLocal(sqlToIso(post.scheduledFor)) : '');
  }, [post]);
  if (!post) return null;
  const save = async () => {
    setBusy(true);
    try {
      if (mode === 'approve') {
        const r = await linkedinQueueApi.approve(post.id, { text, ...(when ? { scheduledFor: localToIso(when) } : {}) });
        toast.success(r.status === 'published' ? tr('Approved and published on LinkedIn') : tr('Approved and scheduled'));
      } else {
        await linkedinQueueApi.update(post.id, { text, ...(post.status === 'scheduled' && when ? { scheduledFor: localToIso(when) } : {}) });
        toast.success(tr('Post saved'));
      }
      onDone();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl flex items-center gap-2"><Linkedin size={18} className="text-[#0A66C2]" /> {mode === 'approve' ? tr('Review and approve') : tr('Edit post')}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {tr('Publishes as {author}.', { author: post.authorLabel ?? post.authorUser ?? 'LinkedIn' })} {mode === 'approve' ? tr('Leave the time empty to publish now.') : ''}
          </DialogDescription>
        </DialogHeader>
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className={`${inputCls} text-sm leading-relaxed`} aria-label={tr('Post text')} />
        <p className={`text-xs ${text.length > 3000 ? 'text-critical' : 'text-text-tertiary'}`}>{tr('{n} of {max} characters', { n: text.length, max: 3000 })}</p>
        {(mode === 'approve' || post.status === 'scheduled') && (
          <label className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
            <Clock size={14} /> {mode === 'approve' ? tr('Publish at (optional)') : tr('Publish at')}
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="bg-bg-input border border-border-default rounded-md h-8 px-2 text-sm text-text-primary" />
          </label>
        )}
        {post.articles.length > 0 && (
          <ul className="text-xs text-text-tertiary space-y-0.5">
            {post.articles.map((a) => <li key={a.id}><a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.title}</a></li>)}
          </ul>
        )}
        <DialogFooter>
          <Button onClick={() => void save()} disabled={busy || !text.trim() || text.length > 3000}>
            {mode === 'approve' ? <Check size={14} /> : <Pencil size={14} />} {busy ? tr('Saving…') : mode === 'approve' ? (when ? tr('Approve and schedule') : tr('Approve and publish')) : tr('Save')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('Cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Channels tab: what LinkedIn channels and people have queued. */
export function LinkedInQueuePanel({ timeZone }: { timeZone?: string }) {
  useI18n();
  const [posts, setPosts] = useState<QueuedPost[] | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [editing, setEditing] = useState<{ post: QueuedPost; mode: 'approve' | 'edit' } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await linkedinQueueApi.list();
      setPosts(r.posts);
      setCanApprove(r.canApprove);
    } catch (err) {
      notifyError(err);
      setPosts([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (p: QueuedPost, fn: () => Promise<unknown>, ok: string) => {
    setBusyId(p.id);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusyId(null);
    }
  };

  if (posts === null) return null;
  const open = posts.filter((p) => p.status === 'pending' || p.status === 'scheduled' || p.status === 'publishing');
  const done = posts.filter((p) => !open.includes(p)).slice(0, 30);
  if (posts.length === 0) return null;

  const row = (p: QueuedPost) => (
    <li key={p.id} className="border border-border-default rounded-lg p-3" data-testid="queue-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[p.status]}>{tr(STATUS_LABEL[p.status])}</Badge>
            <AuthorLine p={p} />
            <span className="text-[11px] text-text-tertiary">
              {p.channel ? tr('from channel {name}', { name: p.channel.name ?? `#${p.channel.id}` }) : tr('scheduled by {name}', { name: p.createdBy ?? '—' })}
            </span>
          </div>
          <p className="text-sm text-text-primary whitespace-pre-wrap line-clamp-3">{p.text}</p>
          <p className="text-[11px] text-text-tertiary">
            {p.status === 'scheduled' && <>{tr('Publishes at')} {formatDateTime(sqlToIso(p.scheduledFor), timeZone)}</>}
            {p.status === 'pending' && <>{tr('Created')} {formatDateTime(sqlToIso(p.createdAt), timeZone)}</>}
            {p.status === 'published' && <>{tr('Published')} {formatDateTime(sqlToIso(p.publishedAt), timeZone)}{p.decidedBy ? ` · ${tr('approved by {name}', { name: p.decidedBy })}` : ''}</>}
            {p.status === 'failed' && <span className="text-critical">{p.error}</span>}
            {(p.status === 'rejected' || p.status === 'cancelled') && p.decidedBy && <>{tr('by {name}', { name: p.decidedBy })}</>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {p.status === 'pending' && canApprove && (
            <>
              <Button size="sm" className="h-8" disabled={busyId === p.id} onClick={() => setEditing({ post: p, mode: 'approve' })}><Check size={14} /> {tr('Review')}</Button>
              <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" disabled={busyId === p.id}
                onClick={() => void act(p, () => linkedinQueueApi.reject(p.id), tr('Post rejected'))} aria-label={tr('Reject')} title={tr('Reject')}><X size={14} /></Button>
            </>
          )}
          {p.status === 'scheduled' && (
            <>
              <Button size="icon-sm" variant="ghost" className="text-text-secondary" disabled={busyId === p.id} onClick={() => setEditing({ post: p, mode: 'edit' })} aria-label={tr('Edit post')}><Pencil size={14} /></Button>
              <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" disabled={busyId === p.id}
                onClick={() => void act(p, () => linkedinQueueApi.cancel(p.id), tr('Post cancelled'))} aria-label={tr('Cancel post')} title={tr('Cancel post')}><Trash2 size={14} /></Button>
            </>
          )}
          {p.url && (
            <Button size="icon-sm" variant="ghost" className="text-text-secondary" asChild>
              <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label={tr('View on LinkedIn')}><ExternalLink size={14} /></a>
            </Button>
          )}
        </div>
      </div>
    </li>
  );

  return (
    <Panel
      title={tr('LinkedIn queue')}
      icon={<Linkedin size={18} />}
      description={tr('Posts waiting for approval or for their time, from LinkedIn channels and from Generate Post. Company admins approve, edit or reject them.')}
      actions={<Button size="sm" variant="outline" className="border-border-default bg-transparent" onClick={() => void load()}><RefreshCw size={14} /> {tr('Refresh')}</Button>}
    >
      {open.length === 0 ? <EmptyState>{tr('Nothing waiting. New posts from LinkedIn channels that need approval appear here.')}</EmptyState> : <ul className="space-y-2">{open.map(row)}</ul>}
      {done.length > 0 && (
        <div className="mt-4">
          <button type="button" className="text-xs text-text-tertiary hover:text-text-primary cursor-pointer" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? tr('Hide history') : tr('Show history ({n})', { n: done.length })}
          </button>
          {showHistory && <ul className="mt-2 space-y-2">{done.map(row)}</ul>}
        </div>
      )}
      <PostEditor post={editing?.post ?? null} mode={editing?.mode ?? 'edit'} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />
    </Panel>
  );
}

/* Generate Post: schedule the current text for a time, as one of my authors.
   Goes out without review, so only approvers (company admins) get it. */
export function LinkedInSchedulePanel({ content }: { content: string }) {
  return useCan()('linkedin.approve') ? <SchedulePanel content={content} /> : null;
}

function SchedulePanel({ content }: { content: string }) {
  useI18n();
  const { status } = useLinkedInStatus();
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<QueuedPost[]>([]);
  const options = authorOptions(status, `${status?.name ?? 'LinkedIn'} (${tr('my profile')})`);
  const [chosen, setChosen] = useState<string | null>(null);
  const author = chosen && options.some((o) => o.value === chosen) ? chosen : pickAuthor(options);

  const load = useCallback(async () => {
    try {
      const r = await linkedinQueueApi.list(['scheduled']);
      setMine(r.posts.filter((p) => !p.channel));
    } catch { /* not configured or no company */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!status?.configured) return null;

  const quick = (kind: 'hour' | 'tomorrow9' | 'tomorrow12') => {
    const d = new Date();
    if (kind === 'hour') d.setHours(d.getHours() + 1, 0, 0, 0);
    else { d.setDate(d.getDate() + 1); d.setHours(kind === 'tomorrow9' ? 9 : 12, 0, 0, 0); }
    setWhen(isoToLocal(d.toISOString()));
  };

  const schedule = async () => {
    setBusy(true);
    try {
      await linkedinQueueApi.schedule({ text: toLinkedInText(content), author, scheduledFor: localToIso(when) });
      rememberAuthor(author);
      toast.success(tr('Scheduled on LinkedIn'));
      setWhen('');
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: QueuedPost) => {
    try {
      await linkedinQueueApi.cancel(p.id);
      toast.success(tr('Post cancelled'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div className="mt-6 bg-bg-card border border-border-default rounded-xl p-5" data-testid="schedule-panel">
      <h3 className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-text-tertiary mb-1">{tr('Schedule on LinkedIn')}</h3>
      <p className="text-xs text-text-tertiary mb-4">{tr('The server publishes it at that time, even if this page is closed.')}</p>

      {options.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-text-secondary">{tr('Connect your LinkedIn account first. Your post is kept while you sign in.')}</p>
          <Button asChild size="sm"><a href={linkedinApi.connectUrl('generate', status.pagesApp && !status.memberPosting ? 'pages' : 'main')} onClick={() => stashDraft(content)}><Linkedin size={14} /> {tr('Connect LinkedIn')}</a></Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-3">
            {options.length > 1 && (
              <label className="flex-1 min-w-[180px] text-[11px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary">
                {tr('Publish as')}
                <select value={author} onChange={(e) => setChosen(e.target.value)} className="mt-1.5 w-full bg-bg-input border border-border-default rounded-lg h-10 px-2 text-sm text-text-primary normal-case tracking-normal font-inter">
                  {options.map((o) => <option key={o.value} value={o.value}>{o.page ? `🏢 ${o.label}` : `👤 ${o.label}`}</option>)}
                </select>
              </label>
            )}
            <label className="flex-1 min-w-[180px] text-[11px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary">
              {tr('Date and time')}
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1.5 w-full bg-bg-input border border-border-default rounded-lg h-10 px-3 text-sm text-text-primary" aria-label={tr('Date and time')} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {([['hour', tr('In 1 hour')], ['tomorrow9', tr('Tomorrow 9:00')], ['tomorrow12', tr('Tomorrow 12:00')]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => quick(k)} className="px-3 py-1.5 text-[11px] font-medium text-text-secondary bg-bg-elevated border border-border-default rounded-md hover:border-text-tertiary hover:text-text-primary cursor-pointer">{label}</button>
            ))}
          </div>
          <Button onClick={() => void schedule()} disabled={busy || !when || !content.trim()} className="w-full">
            <Clock size={16} /> {busy ? tr('Scheduling…') : tr('Schedule post')}
          </Button>
        </>
      )}

      {mine.length > 0 && (
        <div className="mt-5 border-t border-border-default pt-4">
          <h4 className="text-[11px] font-medium font-jetbrains uppercase tracking-[0.08em] text-text-tertiary mb-3">{tr('Scheduled posts')}</h4>
          <ul className="space-y-2 max-h-[220px] overflow-y-auto">
            {mine.map((p) => (
              <li key={p.id} className="flex items-center gap-2 bg-bg-elevated border border-border-default rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-text-primary truncate">{p.text.split('\n')[0]}</p>
                  <p className="text-[11px] text-text-tertiary">{formatDateTime(sqlToIso(p.scheduledFor))} · <AuthorLine p={p} /></p>
                </div>
                <button type="button" onClick={() => void cancel(p)} className="shrink-0 p-1.5 text-text-tertiary hover:text-critical rounded cursor-pointer" aria-label={tr('Cancel post')}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

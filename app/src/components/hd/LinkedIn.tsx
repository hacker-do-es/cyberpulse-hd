import { useState } from 'react';
import { Building2, ExternalLink, Linkedin, Loader2, RefreshCw, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError, linkedinApi, type LinkedInStatus } from '@/services/hdApi';
import { authorOptions, pickAuthor, rememberAuthor, stashDraft, toLinkedInText, useLinkedInStatus } from './linkedinHelpers';
import { formatDateTime, notifyError } from './helpers';
import { tr } from '@/lib/i18n';

/* "Publish to LinkedIn": each user connects their own LinkedIn account and
   publishes generated posts as themselves, after confirming the final text. */

function Avatar({ status }: { status: LinkedInStatus }) {
  return status.pictureUrl
    ? <img src={status.pictureUrl} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" referrerPolicy="no-referrer" />
    : <span className="w-7 h-7 rounded-full bg-[#0A66C2] text-white flex items-center justify-center"><Linkedin size={14} /></span>;
}

export function LinkedInPublishDialog({ text, open, onClose, status, onStatusChange }: {
  text: string;
  open: boolean;
  onClose: () => void;
  status: LinkedInStatus | null;
  onStatusChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const close = () => { setDone(null); onClose(); };

  const options = authorOptions(status, `${status?.name ?? 'LinkedIn'} (${tr('my profile')})`);
  const [chosen, setChosen] = useState<string | null>(null);
  const author = chosen && options.some((o) => o.value === chosen) ? chosen : pickAuthor(options);
  const current = options.find((o) => o.value === author);
  const choose = (v: string) => { setChosen(v); rememberAuthor(v); };

  const max = status?.maxChars ?? 3000;
  const tooLong = text.length > max;

  const publish = async () => {
    if (!author) return;
    setBusy(true);
    try {
      const r = await linkedinApi.publish(text, author);
      setDone(r.url);
      toast.success(tr('Published on LinkedIn'));
    } catch (err) {
      if (err instanceof ApiError && err.data?.code === 'LINKEDIN_RECONNECT') {
        stashDraft(text);
        onStatusChange();
      }
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl flex items-center gap-2"><Linkedin size={18} className="text-[#0A66C2]" /> {tr('Publish to LinkedIn')}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {current?.page
              ? tr('This creates a public post on the LinkedIn Page {page}. Review the text: it is published exactly as shown.', { page: current.label })
              : tr('This creates a public post on your personal LinkedIn profile. Review the text: it is published exactly as shown.')}
          </DialogDescription>
        </DialogHeader>

        {!status?.connected ? (
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">{tr('Connect your LinkedIn account first. Your post is kept while you sign in.')}</p>
            <Button asChild><a href={linkedinApi.connectUrl('generate')} onClick={() => stashDraft(text)}><Linkedin size={14} /> {tr('Connect LinkedIn')}</a></Button>
          </div>
        ) : done ? (
          <div className="space-y-3">
            <p className="text-sm text-low">{tr('Your post is live.')}</p>
            <Button asChild variant="outline" className="border-border-default bg-transparent">
              <a href={done} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> {tr('View on LinkedIn')}</a>
            </Button>
          </div>
        ) : (
          <>
            {options.length > 1 ? (
              <label className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                {current?.page ? <span className="w-7 h-7 rounded bg-[#0A66C2] text-white flex items-center justify-center"><Building2 size={14} /></span> : <Avatar status={status} />}
                <span>{tr('Publish as')}</span>
                <select
                  value={author}
                  onChange={(e) => choose(e.target.value)}
                  className="min-w-0 flex-1 bg-bg-elevated border border-border-default rounded-md h-8 px-2 text-sm text-text-primary"
                  aria-label={tr('Publish as')}
                >
                  {options.map((o) => <option key={o.value} value={o.value}>{o.page ? `🏢 ${o.label}` : `👤 ${o.label}`}</option>)}
                </select>
              </label>
            ) : (
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                {current?.page ? <span className="w-7 h-7 rounded bg-[#0A66C2] text-white flex items-center justify-center"><Building2 size={14} /></span> : <Avatar status={status} />}
                <span>{tr('Publishing as')} <strong className="text-text-primary">{current?.label ?? status.name ?? 'LinkedIn'}</strong></span>
              </div>
            )}
            {status.orgPosting && !status.canPostAsOrganization && (
              <p className="text-xs text-text-tertiary">{tr('To publish as a Company Page, disconnect LinkedIn in My account and connect it again to grant the Page permission.')}</p>
            )}
            {status.canPostAsOrganization && status.organizations.length === 0 && (
              <p className="text-xs text-text-tertiary">{tr('LinkedIn shows no Page where you are an admin or content admin. Check your Page role, then refresh the Pages in My account.')}</p>
            )}
            <div className="whitespace-pre-wrap rounded-lg border border-border-default bg-bg-elevated/60 p-4 text-sm leading-relaxed max-h-[45vh] overflow-y-auto">{text}</div>
            <p className={`text-xs ${tooLong ? 'text-critical' : 'text-text-tertiary'}`}>{tr('{n} of {max} characters', { n: text.length, max })}</p>
          </>
        )}

        <DialogFooter>
          {status?.connected && !done && (
            <Button onClick={() => void publish()} disabled={busy || tooLong || !text || !author}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Linkedin size={14} />} {busy ? tr('Publishing…') : tr('Publish now')}
            </Button>
          )}
          <Button variant="ghost" onClick={close} disabled={busy}>{done ? tr('Close') : tr('Cancel')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Button for the post generator; hidden when the server has no LinkedIn app. */
export function LinkedInPublishButton({ content, className = '' }: { content: string; className?: string }) {
  const { status, reload } = useLinkedInStatus();
  const [open, setOpen] = useState(false);
  if (!status?.configured) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!content} className={`bg-[#0A66C2] text-white hover:brightness-110 ${className}`}>
        <Linkedin size={16} /> {tr('Publish to LinkedIn')}
      </Button>
      <LinkedInPublishDialog text={toLinkedInText(content)} open={open} onClose={() => setOpen(false)} status={status} onStatusChange={() => void reload()} />
    </>
  );
}

/* "My account" section. */
export function LinkedInAccountSection() {
  const { status, reload } = useLinkedInStatus();
  const [busy, setBusy] = useState(false);
  if (!status?.configured) return null;

  const refreshPages = async () => {
    setBusy(true);
    try {
      const r = await linkedinApi.refreshOrganizations();
      toast.success(tr('{n} LinkedIn Page(s) found', { n: r.organizations.length }));
      await reload();
    } catch (err) {
      notifyError(err);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await linkedinApi.disconnect();
      toast.success(tr('LinkedIn disconnected'));
      await reload();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><Linkedin size={15} className="text-[#0A66C2]" /> LinkedIn</h3>
      {status.connected ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Avatar status={status} />
            <div>
              <div className="text-text-primary">{status.name ?? 'LinkedIn'}</div>
              <div className="text-[11px] text-text-tertiary">{tr('Connection valid until {date}', { date: formatDateTime(status.expiresAt) })}</div>
            </div>
          </div>
          <Button size="sm" variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => void disconnect()} disabled={busy}>
            <Unlink size={14} /> {tr('Disconnect')}
          </Button>
          {status.canPostAsOrganization ? (
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-text-tertiary">{tr('Company Pages you can publish as')}</span>
                <Button size="sm" variant="ghost" className="h-7 text-text-secondary" onClick={() => void refreshPages()} disabled={busy}>
                  <RefreshCw size={13} /> {tr('Refresh')}
                </Button>
              </div>
              {status.organizations.length ? (
                <ul className="space-y-1">
                  {status.organizations.map((o) => (
                    <li key={o.urn} className="flex items-center gap-2 text-sm text-text-primary">
                      <Building2 size={14} className="text-[#0A66C2]" /> {o.name ?? o.urn}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-text-tertiary">{tr('None yet. You must be an admin or content admin of the Page on LinkedIn.')}</p>
              )}
            </div>
          ) : status.orgPosting ? (
            <p className="w-full text-xs text-text-tertiary">{tr('To publish as a Company Page, disconnect and connect LinkedIn again to grant the Page permission.')}</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-text-tertiary">
            {status.expired ? tr('Your LinkedIn connection expired (LinkedIn allows 60 days). Connect it again to keep publishing.') : tr('Connect your LinkedIn account to publish generated posts on your profile. Only you can publish with it, and you can disconnect at any time.')}
          </p>
          <Button size="sm" asChild><a href={linkedinApi.connectUrl('account')}><Linkedin size={14} /> {tr('Connect LinkedIn')}</a></Button>
        </div>
      )}
    </section>
  );
}

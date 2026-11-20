import { useCallback, useEffect, useState } from 'react';
import { History, Mail, Pencil, Plus, Radio, Send, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { channelsApi, type Channel, type ChannelInput, type ChannelType, type Delivery, type Severity, type SmtpSettings } from '@/services/hdApi';
import { useAuth } from '@/lib/auth';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { inputCls, selectCls, notifyError, formatDateTime, WEEKDAYS } from './helpers';

const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low and above', medium: 'Medium and above', high: 'High and above', critical: 'Critical only' };
const TYPE_LABEL = { slack: 'Slack', rocketchat: 'Rocket.Chat', email: 'Email' } as const;

function describeSchedule(c: Channel['schedule']): string {
  if (c.type === 'interval') return `Every ${c.intervalHours} h`;
  const days = c.weekdays ?? [];
  const dayText = days.length === 7 ? 'Every day'
    : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)) ? 'Weekdays'
      : WEEKDAYS.filter((w) => days.includes(w.value)).map((w) => w.short).join(', ');
  return `${dayText} at ${c.timeOfDay}`;
}

export default function ChannelsTab() {
  const { me } = useAuth();
  const tz = me?.activeTenant?.timezone;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<Channel | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setChannels(await channelsApi.list());
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (c: Channel, fn: () => Promise<unknown>, ok: string | ((r: { status?: string; articleCount?: number; detail?: string }) => string)) => {
    setBusyId(c.id);
    try {
      const r = (await fn()) as { status?: string; articleCount?: number; detail?: string };
      toast.success(typeof ok === 'string' ? ok : ok(r));
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (c: Channel) => act(c, () => channelsApi.update(c.id, toInput(c, { active: !c.active })), c.active ? 'Channel paused' : 'Channel resumed');

  const remove = (c: Channel) => {
    if (!window.confirm(`Delete channel "${c.name}"?`)) return;
    void act(c, () => channelsApi.remove(c.id), 'Channel deleted');
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader
        title="Output channels"
        subtitle={<>Each channel receives a digest of new security news that matches <strong className="text-text-secondary">{me?.activeTenant?.name}</strong>&apos;s stack, on its own schedule ({tz}).</>}
      />
      <Panel
        title="Channels"
        icon={<Radio size={18} />}
        description="Slack and Rocket.Chat incoming webhooks, or email through your own SMTP server. Articles are never sent twice to the same channel; when nothing new matches, nothing is sent."
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> New channel</Button>}
      >
        {loading ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : channels.length === 0 ? (
          <EmptyState>No channels yet. Add a Slack or Rocket.Chat webhook, or an email list, to start sending digests.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {channels.map((c) => (
              <li key={c.id} className={`border border-border-default rounded-lg p-4 ${c.active ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-rajdhani text-base font-semibold text-text-primary">{c.name}</span>
                      <Badge tone="accent">{c.type === 'email' && <Mail size={10} />} {TYPE_LABEL[c.type]}</Badge>
                      {!c.active && <Badge>Paused</Badge>}
                      {c.useAi && <Badge><Zap size={10} /> AI summary</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-text-tertiary font-jetbrains truncate">{c.webhookHint}</div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                      <span className="text-text-secondary">{describeSchedule(c.schedule)} · {SEVERITY_LABEL[c.minSeverity]} · max {c.maxItems}</span>
                      <span className="text-text-tertiary">Next: <span className="text-text-secondary">{c.active ? formatDateTime(c.nextRunAt, tz) : '—'}</span></span>
                      <span className="text-text-tertiary">Last sent: <span className="text-text-secondary">{formatDateTime(c.lastSentAt, tz)}</span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={c.active} onCheckedChange={() => void toggle(c)} aria-label={c.active ? 'Pause channel' : 'Resume channel'} disabled={busyId === c.id} />
                    <Button size="sm" variant="ghost" className="h-8 text-text-secondary" disabled={busyId === c.id}
                      onClick={() => void act(c, () => channelsApi.test(c.id), 'Test message sent')} title="Send a test message">
                      <Send size={14} /> Test
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-text-secondary" disabled={busyId === c.id}
                      onClick={() => void act(c, () => channelsApi.run(c.id), (r) => r.status === 'sent' ? `Digest sent with ${r.articleCount} articles` : (r.detail ?? 'Nothing to send'))}
                      title="Build and send the digest now">
                      <Zap size={14} /> Send now
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-secondary" onClick={() => setHistoryFor(c)} aria-label="Delivery history"><History size={14} /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-secondary" onClick={() => setEditing(c)} aria-label="Edit channel"><Pencil size={14} /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" onClick={() => remove(c)} aria-label="Delete channel"><Trash2 size={14} /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ChannelDialog
        channel={editing}
        aiConfigured={Boolean(me?.activeTenant?.aiConfigured)}
        onClose={() => setEditing(null)}
        onSaved={async () => { setEditing(null); await load(); }}
      />
      <HistoryDialog channel={historyFor} timeZone={tz} onClose={() => setHistoryFor(null)} />
    </div>
  );
}

function toInput(c: Channel, patch: Partial<ChannelInput> = {}): ChannelInput {
  return {
    name: c.name, type: c.type, active: c.active, schedule: c.schedule,
    minSeverity: c.minSeverity, maxItems: c.maxItems, useAi: c.useAi, ...patch,
  };
}

type Preset = 'daily' | 'weekdays' | 'weekly' | 'custom' | 'interval';

function presetOf(s: Channel['schedule']): Preset {
  if (s.type === 'interval') return 'interval';
  const d = [...(s.weekdays ?? [])].sort().join(',');
  if (d === '0,1,2,3,4,5,6') return 'daily';
  if (d === '1,2,3,4,5') return 'weekdays';
  if ((s.weekdays ?? []).length === 1) return 'weekly';
  return 'custom';
}

type SmtpForm = SmtpSettings & { password: string };
const EMPTY_SMTP: SmtpForm = { host: '', port: 587, security: 'starttls', user: '', password: '', fromAddress: '', fromName: '' };

const EMPTY: ChannelInput = {
  name: '', type: 'slack', webhookUrl: '', active: true,
  schedule: { type: 'weekly', intervalHours: 6, timeOfDay: '08:30', weekdays: [1, 2, 3, 4, 5] },
  minSeverity: 'medium', maxItems: 15, useAi: true, header: null, footer: null, headerHtml: null, footerHtml: null,
};

const splitRecipients = (t: string) => t.split(/[\s,;]+/).map((r) => r.trim()).filter(Boolean);

function ChannelDialog({ channel, aiConfigured, onClose, onSaved }: {
  channel: Channel | 'new' | null;
  aiConfigured: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isNew = channel === 'new';
  const [f, setF] = useState<ChannelInput>(EMPTY);
  const [preset, setPreset] = useState<Preset>('weekdays');
  const [busy, setBusy] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [smtp, setSmtp] = useState<SmtpForm>(EMPTY_SMTP);

  useEffect(() => {
    if (channel === null) return;
    if (channel === 'new') {
      setF(EMPTY);
      setPreset('weekdays');
      setRecipients('');
      setSmtp(EMPTY_SMTP);
    } else {
      setF({ ...toInput(channel), webhookUrl: '', header: channel.header, footer: channel.footer, headerHtml: channel.headerHtml, footerHtml: channel.footerHtml });
      setPreset(presetOf(channel.schedule));
      setRecipients(channel.email?.recipients.join('\n') ?? '');
      setSmtp(channel.email ? { ...channel.email.smtp, password: '' } : EMPTY_SMTP);
    }
  }, [channel]);

  const setSchedule = (patch: Partial<ChannelInput['schedule']>) => setF((p) => ({ ...p, schedule: { ...p.schedule, ...patch } }));

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p === 'interval') setSchedule({ type: 'interval', intervalHours: f.schedule.intervalHours || 6 });
    else if (p === 'daily') setSchedule({ type: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], timeOfDay: f.schedule.timeOfDay || '08:30' });
    else if (p === 'weekdays') setSchedule({ type: 'weekly', weekdays: [1, 2, 3, 4, 5], timeOfDay: f.schedule.timeOfDay || '08:30' });
    else if (p === 'weekly') setSchedule({ type: 'weekly', weekdays: [1], timeOfDay: f.schedule.timeOfDay || '08:30' });
    else setSchedule({ type: 'weekly', timeOfDay: f.schedule.timeOfDay || '08:30' });
  };

  const toggleDay = (d: number) => {
    const days = f.schedule.weekdays ?? [];
    setSchedule({ weekdays: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] });
  };

  const save = async () => {
    setBusy(true);
    try {
      const isEmail = f.type === 'email';
      const payload: ChannelInput = {
        ...f,
        webhookUrl: isEmail ? undefined : f.webhookUrl?.trim() || undefined,
        header: f.header?.trim() || null,
        /* Footer on but empty = default; footer off = '' (none). */
        footer: f.footer === '' ? '' : f.footer?.trim() || null,
        ...(isEmail ? {
          recipients: splitRecipients(recipients),
          smtp: { ...smtp, host: smtp.host.trim(), user: smtp.user.trim(), fromAddress: smtp.fromAddress.trim() || smtp.user.trim(), fromName: smtp.fromName.trim() },
          headerHtml: f.headerHtml?.trim() || null,
          footerHtml: f.footerHtml === '' ? '' : f.footerHtml?.trim() || null,
        } : { headerHtml: undefined, footerHtml: undefined }),
      };
      if (isNew) await channelsApi.create(payload);
      else if (channel) await channelsApi.update(channel.id, payload);
      toast.success(isNew ? 'Channel created' : 'Channel saved');
      await onSaved();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const typeChanged = !isNew && channel && f.type !== channel.type;

  return (
    <Dialog open={channel !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl">{isNew ? 'New channel' : `Edit ${f.name}`}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {f.type === 'email'
              ? 'Digests are emailed to a list of recipients through your own SMTP server.'
              : `Digests go to a ${f.type === 'slack' ? 'Slack' : 'Rocket.Chat'} channel through an incoming webhook.`}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="ch-name">
              <Input id="ch-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="#security-alerts" required maxLength={80} />
            </Field>
            <Field label="Platform" htmlFor="ch-type">
              <select id="ch-type" className={selectCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ChannelType })}>
                <option value="slack">Slack</option>
                <option value="rocketchat">Rocket.Chat</option>
                <option value="email">Email</option>
              </select>
            </Field>
          </div>

          {f.type === 'email' ? (
            <EmailTargetFields
              recipients={recipients}
              onRecipients={setRecipients}
              smtp={smtp}
              onSmtp={setSmtp}
              passwordSaved={Boolean(!isNew && channel && channel.type === 'email' && channel.email?.smtp.passwordSet)}
              defaultOpen={isNew || Boolean(typeChanged)}
            />
          ) : (
            <>
              <WebhookHelp key={f.type} type={f.type} defaultOpen={isNew || Boolean(typeChanged)} />

              <Field
                label="Webhook URL"
                htmlFor="ch-url"
                hint={!isNew && channel && !typeChanged ? <>Saved: <span className="font-jetbrains">{channel.webhookHint}</span>. Leave empty to keep it.</> : 'Stored encrypted. Treat it like a password.'}
              >
                <Input
                  id="ch-url"
                  type="password"
                  autoComplete="off"
                  value={f.webhookUrl ?? ''}
                  onChange={(e) => setF({ ...f, webhookUrl: e.target.value })}
                  className={`${inputCls} font-jetbrains text-xs`}
                  placeholder={f.type === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://chat.example.com/hooks/…'}
                  required={isNew || Boolean(typeChanged)}
                />
              </Field>

            </>
          )}

          <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
            <legend className="px-1 text-xs font-medium text-text-secondary">Schedule</legend>
            <div className="flex flex-wrap gap-1.5">
              {([['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['custom', 'Custom days'], ['interval', 'Every N hours']] as const).map(([p, label]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => choosePreset(p)}
                  className={`px-3 py-1.5 rounded-md text-xs border cursor-pointer transition-colors ${preset === p ? 'border-accent bg-accent/10 text-accent' : 'border-border-default text-text-secondary hover:border-text-tertiary'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {f.schedule.type === 'interval' ? (
              <Field label="Every" htmlFor="ch-int" hint="Between 1 and 168 hours.">
                <div className="flex items-center gap-2">
                  <Input id="ch-int" type="number" min={1} max={168} value={f.schedule.intervalHours ?? 6}
                    onChange={(e) => setSchedule({ intervalHours: Number(e.target.value) })} className={`${inputCls} w-24`} />
                  <span className="text-sm text-text-secondary">hours</span>
                </div>
              </Field>
            ) : (
              <div className="space-y-3">
                {(preset === 'weekly' || preset === 'custom') && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
                    {WEEKDAYS.map((w) => {
                      const on = (f.schedule.weekdays ?? []).includes(w.value);
                      return (
                        <button
                          key={w.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() => (preset === 'weekly' ? setSchedule({ weekdays: [w.value] }) : toggleDay(w.value))}
                          className={`w-11 py-1.5 rounded-md text-xs border cursor-pointer ${on ? 'border-accent bg-accent text-text-inverse font-semibold' : 'border-border-default text-text-secondary'}`}
                        >
                          {w.short}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Field label="At" htmlFor="ch-time">
                  <Input id="ch-time" type="time" value={f.schedule.timeOfDay ?? '08:30'} onChange={(e) => setSchedule({ timeOfDay: e.target.value })} className={`${inputCls} w-32`} required />
                </Field>
              </div>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum severity" htmlFor="ch-sev">
              <select id="ch-sev" className={selectCls} value={f.minSeverity} onChange={(e) => setF({ ...f, minSeverity: e.target.value as Severity })}>
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Max articles per digest" htmlFor="ch-max">
              <Input id="ch-max" type="number" min={1} max={50} value={f.maxItems} onChange={(e) => setF({ ...f, maxItems: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>

          {f.type === 'email' ? (
            <EmailMessageFields f={f} setF={setF} />
          ) : (
          <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
            <legend className="px-1 text-xs font-medium text-text-secondary">Message</legend>
            <Field
              label="Header"
              htmlFor="ch-header"
              hint={<>Leave empty for the default. <span className="font-jetbrains">{'{company}'}</span> and <span className="font-jetbrains">{'{count}'}</span> are replaced by the company name and the number of news.</>}
            >
              <Input
                id="ch-header"
                value={f.header ?? ''}
                onChange={(e) => setF({ ...f, header: e.target.value })}
                className={inputCls}
                maxLength={150}
                placeholder="Hacker-Do CyberPulse · {company} · {count} security updates for your stack"
              />
            </Field>
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch checked={f.footer !== ''} onCheckedChange={(v) => setF({ ...f, footer: v ? null : '' })} />
              <span className="text-sm text-text-primary">Show footer</span>
            </label>
            {f.footer !== '' && (
              <Field label="Footer" htmlFor="ch-footer" hint="Up to 3 lines. Leave empty for the default.">
                <Textarea
                  id="ch-footer"
                  rows={2}
                  value={f.footer ?? ''}
                  onChange={(e) => setF({ ...f, footer: e.target.value === '' ? null : e.target.value })}
                  className={`${inputCls} resize-y`}
                  maxLength={300}
                  placeholder="Generated by Hacker-Do CyberPulse · hacker-do.es"
                />
              </Field>
            )}
            <p className="text-xs text-text-tertiary">Use Test after saving to preview the header and footer in the channel.</p>
          </fieldset>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <Switch checked={f.useAi} onCheckedChange={(v) => setF({ ...f, useAi: v })} className="mt-0.5" />
            <span className="text-sm">
              <span className="text-text-primary">Add an AI executive summary</span>
              <span className="block text-xs text-text-tertiary">
                {aiConfigured ? 'Uses the company’s Claude/OpenAI key. Links always come from the feeds, never from the AI.' : 'No AI key configured for this company yet: the digest will go out without a summary.'}
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create channel' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const WEBHOOK_STEPS: Record<Exclude<ChannelType, 'email'>, { title: string; steps: React.ReactNode[]; notes: React.ReactNode[] }> = {
  slack: {
    title: 'How to get a Slack webhook URL',
    steps: [
      <>Open <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent underline">api.slack.com/apps</a> and click <b>Create New App</b> → <b>From scratch</b> → <b>Pick features</b>.</>,
      <>Under <b>Bot scopes</b> add only <span className="font-jetbrains">incoming-webhook</span>. Leave <b>User scopes</b> empty.</>,
      <>Give the app a name (e.g. “Security Alerts”), choose the workspace and create it.</>,
      <>In the left menu open <b>Incoming Webhooks</b>, switch it <b>On</b> and click <b>Add New Webhook</b>.</>,
      <>Pick the channel and click <b>Allow</b>.</>,
      <>Copy the <b>Webhook URL</b> (<span className="font-jetbrains">https://hooks.slack.com/services/…</span>) and paste it below.</>,
    ],
    notes: [
      'If your workspace requires app approval, a Slack admin has to approve the install.',
      'Private channels only show up if you are a member.',
      'Optional: set the app icon and name under Basic Information → Display Information; that is what the channel shows as the sender.',
    ],
  },
  rocketchat: {
    title: 'How to get a Rocket.Chat webhook URL',
    steps: [
      <>Log in as a user with permission to manage integrations (usually an admin).</>,
      <>Go to <b>Administration</b> (Workspace) → <b>Integrations</b> → <b>New</b> → <b>Incoming</b>.</>,
      <>Turn <b>Enabled</b> on and give it a name (e.g. “Security Alerts”).</>,
      <>In <b>Post to Channel</b> type the channel (<span className="font-jetbrains">#security-alerts</span>) and in <b>Post as</b> an existing user, e.g. a bot user or <span className="font-jetbrains">rocket.cat</span>.</>,
      <>Optional: set <b>Alias</b> and <b>Avatar URL</b> to choose how the sender looks. Leave <b>Script</b> disabled.</>,
      <>Click <b>Save</b>, then copy the <b>Webhook URL</b> (<span className="font-jetbrains">https://chat.example.com/hooks/…</span>) and paste it below.</>,
    ],
    notes: [
      'The “Post as” user must be a member of the channel.',
      'The Rocket.Chat server must be reachable over HTTPS from the internet. Servers on a private network need CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS on the CyberPulse side (ask Hacker-Do).',
    ],
  },
};

function WebhookHelp({ type, defaultOpen }: { type: Exclude<ChannelType, 'email'>; defaultOpen: boolean }) {
  const h = WEBHOOK_STEPS[type];
  return (
    <details className="group rounded-lg border border-border-default bg-bg-elevated/40 px-4 py-3 text-xs" open={defaultOpen}>
      <summary className="cursor-pointer select-none font-medium text-text-secondary">{h.title}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-secondary">
        {h.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <ul className="mt-2 space-y-0.5 text-text-tertiary">
        {h.notes.map((n, i) => <li key={i}>· {n}</li>)}
      </ul>
      <p className="mt-2 text-text-tertiary">The URL works like a password: anyone who has it can post to the channel. Don’t share it by chat or email.</p>
    </details>
  );
}

function EmailTargetFields({ recipients, onRecipients, smtp, onSmtp, passwordSaved, defaultOpen }: {
  recipients: string;
  onRecipients: (v: string) => void;
  smtp: SmtpForm;
  onSmtp: (v: SmtpForm) => void;
  passwordSaved: boolean;
  defaultOpen: boolean;
}) {
  const set = (patch: Partial<SmtpForm>) => onSmtp({ ...smtp, ...patch });
  const count = splitRecipients(recipients).length;
  return (
    <>
      <Field label="Recipients" htmlFor="ch-rcpt" hint={`One per line (or comma-separated), up to 20. Each recipient gets their own copy and never sees the others.${count ? ` ${count} entered.` : ''}`}>
        <Textarea id="ch-rcpt" rows={3} value={recipients} onChange={(e) => onRecipients(e.target.value)} className={`${inputCls} font-jetbrains text-xs resize-y`} placeholder={'soc@company.com\nit-team@company.com'} required />
      </Field>

      <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
        <legend className="px-1 text-xs font-medium text-text-secondary">SMTP server</legend>
        <details className="rounded-lg border border-border-default bg-bg-elevated/40 px-4 py-3 text-xs" open={defaultOpen}>
          <summary className="cursor-pointer select-none font-medium text-text-secondary">How to send through Gmail / Google Workspace</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-secondary">
            <li>Turn on 2-Step Verification on the Google account that will send.</li>
            <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent underline">myaccount.google.com/apppasswords</a>, create an app password named e.g. “CyberPulse” and copy the 16 letters.</li>
            <li>Server <span className="font-jetbrains">smtp.gmail.com</span>, port <span className="font-jetbrains">587</span>, STARTTLS, user = the full Gmail address, password = the app password.</li>
            <li>To send as another address (e.g. alerts@yourdomain), add it first in Gmail → Settings → Accounts → “Send mail as”.</li>
          </ol>
          <p className="mt-2 text-text-tertiary">Other providers work the same way (Microsoft 365: smtp.office365.com, 587, STARTTLS). Only public servers on ports 25, 465, 587 or 2525 with TLS are accepted.</p>
        </details>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem_9rem]">
          <Field label="Server" htmlFor="ch-smtp-host">
            <Input id="ch-smtp-host" value={smtp.host} onChange={(e) => set({ host: e.target.value })} className={`${inputCls} font-jetbrains text-xs`} placeholder="smtp.gmail.com" required />
          </Field>
          <Field label="Port" htmlFor="ch-smtp-port">
            <select id="ch-smtp-port" className={selectCls} value={smtp.port}
              onChange={(e) => { const port = Number(e.target.value); set({ port, security: port === 465 ? 'tls' : 'starttls' }); }}>
              {[587, 465, 2525, 25].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Security" htmlFor="ch-smtp-sec">
            <select id="ch-smtp-sec" className={selectCls} value={smtp.security} onChange={(e) => set({ security: e.target.value as SmtpForm['security'] })}>
              <option value="starttls">STARTTLS</option>
              <option value="tls">TLS (SSL)</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="User" htmlFor="ch-smtp-user">
            <Input id="ch-smtp-user" autoComplete="off" value={smtp.user} onChange={(e) => set({ user: e.target.value })} className={inputCls} placeholder="alerts@company.com" required />
          </Field>
          <Field label="Password" htmlFor="ch-smtp-pass" hint={passwordSaved ? 'Saved. Leave empty to keep it.' : 'Stored encrypted, never shown again.'}>
            <Input id="ch-smtp-pass" type="password" autoComplete="new-password" value={smtp.password} onChange={(e) => set({ password: e.target.value })} className={inputCls} placeholder={passwordSaved ? '••••••••' : 'App password'} required={!passwordSaved} />
          </Field>
          <Field label="Sender address" htmlFor="ch-smtp-from" hint="Empty = the SMTP user.">
            <Input id="ch-smtp-from" type="email" value={smtp.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} className={inputCls} placeholder="alerts@company.com" />
          </Field>
          <Field label="Sender name" htmlFor="ch-smtp-name">
            <Input id="ch-smtp-name" value={smtp.fromName} onChange={(e) => set({ fromName: e.target.value })} className={inputCls} maxLength={80} placeholder="Security Alerts" />
          </Field>
        </div>
      </fieldset>
    </>
  );
}

function EmailMessageFields({ f, setF }: { f: ChannelInput; setF: (v: ChannelInput) => void }) {
  return (
    <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
      <legend className="px-1 text-xs font-medium text-text-secondary">Message</legend>
      <Field
        label="Subject"
        htmlFor="ch-subject"
        hint={<>Leave empty for the default. <span className="font-jetbrains">{'{company}'}</span> and <span className="font-jetbrains">{'{count}'}</span> work here and in the HTML below.</>}
      >
        <Input id="ch-subject" value={f.header ?? ''} onChange={(e) => setF({ ...f, header: e.target.value })} className={inputCls} maxLength={150}
          placeholder="Hacker-Do CyberPulse · {company} · {count} security updates for your stack" />
      </Field>
      <Field label="Header (HTML)" htmlFor="ch-hhtml" hint="Shown above the news. Empty = the subject as a title. Images by https URL, e.g. your hosted logo.">
        <Textarea id="ch-hhtml" rows={4} value={f.headerHtml ?? ''} onChange={(e) => setF({ ...f, headerHtml: e.target.value })} className={`${inputCls} font-jetbrains text-xs resize-y`} maxLength={10000}
          placeholder={'<img src="https://company.com/logo.png" alt="Company" width="140">\n<h2>Security briefing for {company}</h2>'} />
      </Field>
      <label className="flex items-center gap-3 cursor-pointer">
        <Switch checked={f.footerHtml !== ''} onCheckedChange={(v) => setF({ ...f, footerHtml: v ? null : '' })} />
        <span className="text-sm text-text-primary">Show footer</span>
      </label>
      {f.footerHtml !== '' && (
        <Field label="Footer (HTML)" htmlFor="ch-fhtml" hint="Empty = the default footer.">
          <Textarea id="ch-fhtml" rows={3} value={f.footerHtml ?? ''} onChange={(e) => setF({ ...f, footerHtml: e.target.value === '' ? null : e.target.value })} className={`${inputCls} font-jetbrains text-xs resize-y`} maxLength={10000}
            placeholder={'<p>Company SOC · <a href="https://company.com">company.com</a></p>'} />
        </Field>
      )}
      <EmailPreview header={f.header ?? null} headerHtml={f.headerHtml ?? null} footerHtml={f.footerHtml ?? null} />
      <p className="text-xs text-text-tertiary">Scripts, forms and external styles are removed when saving; the preview shows exactly what will be sent. Use Test after saving to check it in a real inbox.</p>
    </fieldset>
  );
}

function EmailPreview({ header, headerHtml, footerHtml }: { header: string | null; headerHtml: string | null; footerHtml: string | null }) {
  const [html, setHtml] = useState('');
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      channelsApi.previewEmail({ header: header?.trim() || null, headerHtml: headerHtml?.trim() || null, footerHtml: footerHtml === '' ? '' : footerHtml?.trim() || null })
        .then((h) => { if (!cancelled) setHtml(h); })
        .catch(() => { /* the form still saves; errors show there */ });
    }, 500);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [header, headerHtml, footerHtml]);
  return (
    <div>
      <div className="text-xs font-medium text-text-secondary mb-1.5">Preview (sample news)</div>
      {/* No scripts, no same-origin: the HTML cannot touch the app. */}
      <iframe title="Email preview" sandbox="" srcDoc={html} className="w-full h-[420px] rounded-md border border-border-default bg-white" />
    </div>
  );
}

function HistoryDialog({ channel, timeZone, onClose }: { channel: Channel | null; timeZone?: string; onClose: () => void }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  useEffect(() => {
    if (!channel) return;
    setRows(null);
    channelsApi.deliveries(channel.id).then(setRows).catch((err) => { notifyError(err); setRows([]); });
  }, [channel]);

  const tone = (s: Delivery['status']) => (s === 'sent' ? 'ok' : s === 'error' ? 'bad' : 'neutral') as 'ok' | 'bad' | 'neutral';

  return (
    <Dialog open={channel !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">Delivery history · {channel?.name}</DialogTitle></DialogHeader>
        {rows === null ? <p className="text-sm text-text-tertiary">Loading…</p> : rows.length === 0 ? (
          <EmptyState>Nothing sent yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-border-default">
            {rows.map((d) => (
              <li key={d.id} className="py-2.5 flex items-start gap-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-text-tertiary font-jetbrains">{formatDateTime(d.createdAt, timeZone)}</span>
                <Badge tone={tone(d.status)}>{d.status}</Badge>
                <span className="text-text-secondary text-xs flex-1 break-words">
                  {d.trigger === 'manual' ? 'Manual · ' : ''}{d.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

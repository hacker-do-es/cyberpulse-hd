import { useCallback, useEffect, useState } from 'react';
import { HardDrive, History, Linkedin, Mail, Pencil, Plus, Radio, Send, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { channelsApi, type Channel, type ChannelInput, type ChannelType, type Delivery, type LinkedInChannelSettings, type Severity, type SmtpSettings } from '@/services/hdApi';
import { LinkedInQueuePanel } from './LinkedInQueue';
import { authorOptions, useLinkedInStatus } from './linkedinHelpers';
import { useAuth } from '@/lib/auth';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { criticalityLabel } from './assetLabels';
import { inputCls, selectCls, notifyError, formatDateTime, WEEKDAYS } from './helpers';
import { getLang, tr, trMessage } from '@/lib/i18n';

const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low and above', medium: 'Medium and above', high: 'High and above', critical: 'Critical only' };
const TYPE_LABEL = { slack: 'Slack', rocketchat: 'Rocket.Chat', discord: 'Discord', telegram: 'Telegram', email: 'Email', linkedin: 'LinkedIn' } as const;

const LI_FORMATS: Array<[string, string]> = [['News Analysis', 'News Analysis'], ['Quick Summary', 'Quick Summary'], ['Thread', 'Thread / Carousel'], ['Contrarian', 'Contrarian Take'], ['Storytelling', 'Storytelling'], ['Daily Digest', 'Daily Digest']];
const LI_TONES = ['Professional', 'Casual', 'Urgent', 'Educational', 'Thought Leadership'];
const LI_DEFAULT: LinkedInChannelSettings = {
  author: null, format: 'News Analysis', tone: 'Professional', length: 'medium', language: 'es',
  postsPerRun: 1, maxPostsPerDay: 2, requireApproval: null,
};

function describeSchedule(c: Channel['schedule']): string {
  if (c.type === 'interval') return tr('Every {n} h', { n: c.intervalHours ?? '' });
  const days = c.weekdays ?? [];
  const dayText = days.length === 7 ? tr('Every day')
    : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)) ? tr('Weekdays')
      : WEEKDAYS.filter((w) => days.includes(w.value)).map((w) => tr(w.short)).join(', ');
  return tr('{days} at {time}', { days: dayText, time: c.timeOfDay ?? '' });
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

  const toggle = (c: Channel) => act(c, () => channelsApi.update(c.id, toInput(c, { active: !c.active })), c.active ? tr('Channel paused') : tr('Channel resumed'));

  const remove = (c: Channel) => {
    if (!window.confirm(tr('Delete channel "{name}"?', { name: c.name }))) return;
    void act(c, () => channelsApi.remove(c.id), tr('Channel deleted'));
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader
        title={tr("Output channels")}
        subtitle={<>{tr("Each channel receives a digest of new security news that matches")} <strong className="text-text-secondary">{me?.activeTenant?.name}</strong>{tr("'s stack, on its own schedule (")}{tz}).</>}
      />
      <Panel
        title={tr("Channels")}
        icon={<Radio size={18} />}
        description={tr("Slack, Rocket.Chat and Discord webhooks, a Telegram bot, or email through your own SMTP server. Articles are never sent twice to the same channel; when nothing new matches, nothing is sent.")}
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> {tr("New channel")}</Button>}
      >
        {loading ? (
          <p className="text-sm text-text-tertiary">{tr("Loading…")}</p>
        ) : channels.length === 0 ? (
          <EmptyState>{tr("No channels yet. Add a Slack, Rocket.Chat or Discord webhook, a Telegram bot or an email list to start sending digests.")}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {channels.map((c) => (
              <li key={c.id} className={`border border-border-default rounded-lg p-4 ${c.active ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-rajdhani text-base font-semibold text-text-primary">{c.name}</span>
                      <Badge tone="accent">{c.type === 'email' && <Mail size={10} />}{c.type === 'linkedin' && <Linkedin size={10} />} {TYPE_LABEL[c.type]}</Badge>
                      {c.type === 'linkedin' && c.linkedin?.requireApproval && <Badge>{tr('Needs approval')}</Badge>}
                      {!c.active && <Badge>{tr("Paused")}</Badge>}
                      {c.useAi && <Badge><Zap size={10} /> {tr("AI summary")}</Badge>}
                      {c.includeAssets && <Badge tone="warn"><HardDrive size={10} /> {tr("Lists assets")}</Badge>}
                      {c.minAssetCriticality && <Badge>{tr('Assets ≥ {level}', { level: criticalityLabel(c.minAssetCriticality) })}</Badge>}
                    </div>
                    <div className="mt-1 text-xs text-text-tertiary font-jetbrains truncate">{trMessage(c.webhookHint)}</div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs">
                      <span className="text-text-secondary">{describeSchedule(c.schedule)} · {tr(SEVERITY_LABEL[c.minSeverity])} {tr("· max")} {c.maxItems}</span>
                      <span className="text-text-tertiary">{tr("Next:")} <span className="text-text-secondary">{c.active ? formatDateTime(c.nextRunAt, tz) : '—'}</span></span>
                      <span className="text-text-tertiary">{tr("Last sent:")} <span className="text-text-secondary">{formatDateTime(c.lastSentAt, tz)}</span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={c.active} onCheckedChange={() => void toggle(c)} aria-label={c.active ? tr('Pause channel') : tr('Resume channel')} disabled={busyId === c.id} />
                    <Button size="sm" variant="ghost" className="h-8 text-text-secondary" disabled={busyId === c.id}
                      onClick={() => void act(c, () => channelsApi.test(c.id), c.type === 'linkedin' ? tr('The LinkedIn connection works') : tr('Test message sent'))} title={c.type === 'linkedin' ? tr('Check the LinkedIn connection (publishes nothing)') : tr("Send a test message")}>
                      <Send size={14} /> {tr("Test")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-text-secondary" disabled={busyId === c.id}
                      onClick={() => void act(c, () => channelsApi.run(c.id), (r) => c.type === 'linkedin' ? trMessage(r.detail ?? '') : r.status === 'sent' ? tr('Digest sent with {n} articles', { n: r.articleCount ?? 0 }) : (r.detail ?? tr('Nothing to send')))}
                      title={tr("Build and send the digest now")}>
                      <Zap size={14} /> {tr("Send now")}
                    </Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-secondary" onClick={() => setHistoryFor(c)} aria-label={tr("Delivery history")}><History size={14} /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-secondary" onClick={() => setEditing(c)} aria-label={tr("Edit channel")}><Pencil size={14} /></Button>
                    <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" onClick={() => remove(c)} aria-label={tr("Delete channel")}><Trash2 size={14} /></Button>
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
      <div className="mt-6"><LinkedInQueuePanel timeZone={tz} /></div>
    </div>
  );
}

function toInput(c: Channel, patch: Partial<ChannelInput> = {}): ChannelInput {
  return {
    name: c.name, type: c.type, active: c.active, schedule: c.schedule,
    minSeverity: c.minSeverity, maxItems: c.maxItems, useAi: c.useAi,
    includeAssets: c.includeAssets, minAssetCriticality: c.minAssetCriticality, ...patch,
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
  includeAssets: false, minAssetCriticality: null,
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
  const [tg, setTg] = useState({ botToken: '', chatId: '' });
  const [li, setLi] = useState<LinkedInChannelSettings>(LI_DEFAULT);
  const liStatus = useLinkedInStatus().status;
  const liOptions = authorOptions(liStatus, `${liStatus?.name ?? 'LinkedIn'} (${tr('my profile')})`);

  useEffect(() => {
    if (channel === null) return;
    if (channel === 'new') {
      setF(EMPTY);
      setPreset('weekdays');
      setRecipients('');
      setSmtp(EMPTY_SMTP);
      setTg({ botToken: '', chatId: '' });
      setLi(LI_DEFAULT);
    } else {
      setF({ ...toInput(channel), webhookUrl: '', header: channel.header, footer: channel.footer, headerHtml: channel.headerHtml, footerHtml: channel.footerHtml });
      setPreset(presetOf(channel.schedule));
      setRecipients(channel.email?.recipients.join('\n') ?? '');
      setSmtp(channel.email ? { ...channel.email.smtp, password: '' } : EMPTY_SMTP);
      setTg({ botToken: '', chatId: channel.telegram?.chatId ?? '' });
      setLi(channel.linkedin ? { ...LI_DEFAULT, ...Object.fromEntries(Object.entries(channel.linkedin).filter(([, v]) => v !== null)) } as LinkedInChannelSettings : LI_DEFAULT);
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
      const isTelegram = f.type === 'telegram';
      const isLinkedIn = f.type === 'linkedin';
      const liAuthor = li.author ?? liOptions[0]?.value ?? null;
      const payload: ChannelInput = {
        ...f,
        webhookUrl: isEmail || isTelegram || isLinkedIn ? undefined : f.webhookUrl?.trim() || undefined,
        linkedin: isLinkedIn ? { ...li, author: liAuthor, requireApproval: li.requireApproval ?? liAuthor !== 'member' } : undefined,
        telegram: isTelegram ? { botToken: tg.botToken.trim() || undefined, chatId: tg.chatId.trim() } : undefined,
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
      toast.success(isNew ? tr('Channel created') : tr('Channel saved'));
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
          <DialogTitle className="font-rajdhani text-xl">{isNew ? tr('New channel') : tr('Edit {name}', { name: f.name })}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {f.type === 'email'
              ? tr('Digests are emailed to a list of recipients through your own SMTP server.')
              : f.type === 'telegram'
                ? tr('Digests are posted to a Telegram group or channel by your own bot.')
                : f.type === 'linkedin'
                ? tr('Writes LinkedIn posts about new stories that match your stack and publishes them with your LinkedIn connection, or leaves them for approval.')
                : tr('Digests go to a {platform} channel through an incoming webhook.', { platform: TYPE_LABEL[f.type] })}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Name")} htmlFor="ch-name">
              <Input id="ch-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="#security-alerts" required maxLength={80} />
            </Field>
            <Field label={tr("Platform")} htmlFor="ch-type">
              <select id="ch-type" className={selectCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ChannelType })}>
                <option value="slack">{tr("Slack")}</option>
                <option value="rocketchat">{tr("Rocket.Chat")}</option>
                <option value="discord">Discord</option>
                <option value="telegram">Telegram</option>
                {(liStatus?.configured || f.type === 'linkedin') && <option value="linkedin">LinkedIn</option>}
                <option value="email">{tr("Email")}</option>
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
          ) : f.type === 'linkedin' ? (
            <LinkedInChannelFields li={li} setLi={setLi} options={liOptions} owner={!isNew && channel ? channel.linkedin?.owner ?? null : null} configured={Boolean(liStatus?.configured)} />
          ) : f.type === 'telegram' ? (
            <>
              <WebhookHelp key={f.type} type={f.type} defaultOpen={isNew || Boolean(typeChanged)} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={tr('Bot token')}
                  htmlFor="ch-tg-token"
                  hint={!isNew && channel && channel.type === 'telegram' && !typeChanged ? tr('Saved (bot {id}). Leave empty to keep it.', { id: channel.telegram?.botId ?? '' }) : tr('Stored encrypted. Treat it like a password.')}
                >
                  <Input id="ch-tg-token" type="password" autoComplete="off" value={tg.botToken} onChange={(e) => setTg({ ...tg, botToken: e.target.value })} className={`${inputCls} font-jetbrains text-xs`} placeholder="123456789:AA…" required={isNew || Boolean(typeChanged)} />
                </Field>
                <Field label={tr('Chat ID')} htmlFor="ch-tg-chat" hint={tr('Number (groups and channels start with -100) or @channelname.')}>
                  <Input id="ch-tg-chat" value={tg.chatId} onChange={(e) => setTg({ ...tg, chatId: e.target.value })} className={`${inputCls} font-jetbrains text-xs`} placeholder="-1001234567890" required />
                </Field>
              </div>
            </>
          ) : (
            <>
              <WebhookHelp key={f.type} type={f.type} defaultOpen={isNew || Boolean(typeChanged)} />

              <Field
                label={tr("Webhook URL")}
                htmlFor="ch-url"
                hint={!isNew && channel && !typeChanged ? <>{tr("Saved:")} <span className="font-jetbrains">{channel.webhookHint}</span>{tr(". Leave empty to keep it.")}</> : tr('Stored encrypted. Treat it like a password.')}
              >
                <Input
                  id="ch-url"
                  type="password"
                  autoComplete="off"
                  value={f.webhookUrl ?? ''}
                  onChange={(e) => setF({ ...f, webhookUrl: e.target.value })}
                  className={`${inputCls} font-jetbrains text-xs`}
                  placeholder={f.type === 'slack' ? 'https://hooks.slack.com/services/…' : f.type === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://chat.example.com/hooks/…'}
                  required={isNew || Boolean(typeChanged)}
                />
              </Field>

            </>
          )}

          <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
            <legend className="px-1 text-xs font-medium text-text-secondary">{tr("Schedule")}</legend>
            <div className="flex flex-wrap gap-1.5">
              {([['daily', tr('Daily')], ['weekdays', tr('Weekdays')], ['weekly', tr('Weekly')], ['custom', tr('Custom days')], ['interval', tr('Every N hours')]] as const).map(([p, label]) => (
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
              <Field label={tr("Every")} htmlFor="ch-int" hint={tr("Between 1 and 168 hours.")}>
                <div className="flex items-center gap-2">
                  <Input id="ch-int" type="number" min={1} max={168} value={f.schedule.intervalHours ?? 6}
                    onChange={(e) => setSchedule({ intervalHours: Number(e.target.value) })} className={`${inputCls} w-24`} />
                  <span className="text-sm text-text-secondary">{tr("hours")}</span>
                </div>
              </Field>
            ) : (
              <div className="space-y-3">
                {(preset === 'weekly' || preset === 'custom') && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("Days")}>
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
                          {tr(w.short)}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Field label={tr("At")} htmlFor="ch-time">
                  <Input id="ch-time" type="time" value={f.schedule.timeOfDay ?? '08:30'} onChange={(e) => setSchedule({ timeOfDay: e.target.value })} className={`${inputCls} w-32`} required />
                </Field>
              </div>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Minimum severity")} htmlFor="ch-sev">
              <select id="ch-sev" className={selectCls} value={f.minSeverity} onChange={(e) => setF({ ...f, minSeverity: e.target.value as Severity })}>
                {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => <option key={s} value={s}>{tr(SEVERITY_LABEL[s])}</option>)}
              </select>
            </Field>
            {f.type !== 'linkedin' && <Field label={tr("Max articles per digest")} htmlFor="ch-max">
              <Input id="ch-max" type="number" min={1} max={50} value={f.maxItems} onChange={(e) => setF({ ...f, maxItems: Number(e.target.value) })} className={inputCls} />
            </Field>}
          </div>

          {f.type === 'linkedin' ? null : f.type === 'email' ? (
            <EmailMessageFields f={f} setF={setF} />
          ) : (
          <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
            <legend className="px-1 text-xs font-medium text-text-secondary">{tr("Message")}</legend>
            <Field
              label={tr("Header")}
              htmlFor="ch-header"
              hint={<>{tr("Leave empty for the default.")} <span className="font-jetbrains">{'{company}'}</span> {tr("and")} <span className="font-jetbrains">{'{count}'}</span> {tr("are replaced by the company name and the number of news.")}</>}
            >
              <Input
                id="ch-header"
                value={f.header ?? ''}
                onChange={(e) => setF({ ...f, header: e.target.value })}
                className={inputCls}
                maxLength={150}
                placeholder={tr("Hacker-Do CyberPulse · {company} · {count} security updates for your stack")}
              />
            </Field>
            <label className="flex items-center gap-3 cursor-pointer">
              <Switch checked={f.footer !== ''} onCheckedChange={(v) => setF({ ...f, footer: v ? null : '' })} />
              <span className="text-sm text-text-primary">{tr("Show footer")}</span>
            </label>
            {f.footer !== '' && (
              <Field label={tr("Footer")} htmlFor="ch-footer" hint={tr("Up to 3 lines. Leave empty for the default.")}>
                <Textarea
                  id="ch-footer"
                  rows={2}
                  value={f.footer ?? ''}
                  onChange={(e) => setF({ ...f, footer: e.target.value === '' ? null : e.target.value })}
                  className={`${inputCls} resize-y`}
                  maxLength={300}
                  placeholder={tr("Generated by Hacker-Do CyberPulse · hacker-do.es")}
                />
              </Field>
            )}
            <p className="text-xs text-text-tertiary">{tr("Use Test after saving to preview the header and footer in the channel.")}</p>
          </fieldset>
          )}

          {f.type !== 'linkedin' && (
            <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
              <legend className="px-1 text-xs font-medium text-text-secondary">{tr("Affected assets")}</legend>
              <label className="flex items-start gap-3 cursor-pointer">
                <Switch checked={!!f.includeAssets} onCheckedChange={(v) => setF({ ...f, includeAssets: v })} className="mt-0.5" />
                <span className="text-sm">
                  <span className="text-text-primary">{tr("List the affected assets under each news item")}</span>
                  <span className="block text-xs text-text-tertiary">
                    {tr("Asset names map your attack surface: turn this on only if everyone who reads this channel may see them. They are never sent to the AI provider.")}
                  </span>
                </span>
              </label>
              <Field
                label={tr("Only news that affects assets of criticality")}
                htmlFor="ch-asset-crit"
                hint={tr("News about technologies with no linked asset is left out when a level is chosen.")}
              >
                <select
                  id="ch-asset-crit"
                  className={selectCls}
                  value={f.minAssetCriticality ?? ''}
                  onChange={(e) => setF({ ...f, minAssetCriticality: (e.target.value || null) as ChannelInput['minAssetCriticality'] })}
                >
                  <option value="">{tr("Any (all news matching the stack)")}</option>
                  <option value="high">{tr("High")}</option>
                  <option value="medium">{tr("Medium or higher")}</option>
                  <option value="low">{tr("Any linked asset")}</option>
                </select>
              </Field>
            </fieldset>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <Switch checked={f.useAi} onCheckedChange={(v) => setF({ ...f, useAi: v })} className="mt-0.5" />
            <span className="text-sm">
              <span className="text-text-primary">{f.type === 'linkedin' ? tr('Write the posts with AI') : tr("Add an AI executive summary")}</span>
              <span className="block text-xs text-text-tertiary">
                {f.type === 'linkedin'
                  ? (aiConfigured ? tr('Uses the company’s Claude/OpenAI key; the templates are used if it fails. The Daily Digest format always uses the template.') : tr('No AI key configured for this company yet: posts use the templates.'))
                  : aiConfigured ? tr('Uses the company’s Claude/OpenAI key. Links always come from the feeds, never from the AI.') : tr('No AI key configured for this company yet: the digest will go out without a summary.')}
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : isNew ? tr('Create channel') : tr('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkedInChannelFields({ li, setLi, options, owner, configured }: {
  li: LinkedInChannelSettings;
  setLi: (v: LinkedInChannelSettings) => void;
  options: Array<{ value: string; label: string; page: boolean }>;
  owner: { id: number; name: string } | null;
  configured: boolean;
}) {
  const set = (patch: Partial<LinkedInChannelSettings>) => setLi({ ...li, ...patch });
  const author = li.author ?? options[0]?.value ?? '';
  const approval = li.requireApproval ?? author !== 'member';
  if (!configured) return <p className="text-sm text-text-tertiary">{tr('LinkedIn is not configured on this server.')}</p>;
  return (
    <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
      <legend className="px-1 text-xs font-medium text-text-secondary">LinkedIn</legend>
      {options.length === 0 ? (
        <p className="text-sm text-text-secondary">{tr('Connect your LinkedIn account in My account first: the channel publishes with your connection.')}</p>
      ) : (
        <Field label={tr('Publish as')} htmlFor="ch-li-author" hint={owner ? tr('Publishes with the LinkedIn connection of {name}. Choosing an author makes it yours.', { name: owner.name }) : tr('Publishes with your LinkedIn connection.')}>
          <select id="ch-li-author" className={selectCls} value={author} onChange={(e) => set({ author: e.target.value, requireApproval: null })}>
            {li.author && !options.some((o) => o.value === li.author) && <option value={li.author}>{li.author === 'member' ? tr('Profile of {name}', { name: owner?.name ?? '—' }) : li.author}</option>}
            {options.map((o) => <option key={o.value} value={o.value}>{o.page ? `🏢 ${o.label}` : `👤 ${o.label}`}</option>)}
          </select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr('Format')} htmlFor="ch-li-format">
          <select id="ch-li-format" className={selectCls} value={li.format ?? 'News Analysis'} onChange={(e) => set({ format: e.target.value })}>
            {LI_FORMATS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
          </select>
        </Field>
        <Field label={tr('Tone')} htmlFor="ch-li-tone">
          <select id="ch-li-tone" className={selectCls} value={li.tone ?? 'Professional'} onChange={(e) => set({ tone: e.target.value })}>
            {LI_TONES.map((t) => <option key={t} value={t}>{tr(t)}</option>)}
          </select>
        </Field>
        <Field label={tr('Length')} htmlFor="ch-li-length">
          <select id="ch-li-length" className={selectCls} value={li.length ?? 'medium'} onChange={(e) => set({ length: e.target.value })}>
            <option value="short">{tr('Short')}</option>
            <option value="medium">{tr('Medium')}</option>
            <option value="long">{tr('Long')}</option>
          </select>
        </Field>
        <Field label={tr('Language')} htmlFor="ch-li-lang">
          <select id="ch-li-lang" className={selectCls} value={li.language ?? 'es'} onChange={(e) => set({ language: e.target.value as 'es' | 'en' })}>
            <option value="es">{tr('Spanish')}</option>
            <option value="en">{tr('English')}</option>
          </select>
        </Field>
        <Field label={tr('Posts per run')} htmlFor="ch-li-run" hint={li.format === 'Daily Digest' ? tr('Daily Digest makes one post with several stories.') : tr('Each post is about a different story.')}>
          <Input id="ch-li-run" type="number" min={1} max={5} value={li.postsPerRun ?? 1} onChange={(e) => set({ postsPerRun: Number(e.target.value) })} className={inputCls} />
        </Field>
        <Field label={tr('Max posts per day')} htmlFor="ch-li-day" hint={tr('Counted over the last 24 hours, including posts waiting for approval.')}>
          <Input id="ch-li-day" type="number" min={1} max={10} value={li.maxPostsPerDay ?? 2} onChange={(e) => set({ maxPostsPerDay: Number(e.target.value) })} className={inputCls} />
        </Field>
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <Switch checked={approval} onCheckedChange={(v) => set({ requireApproval: v })} className="mt-0.5" />
        <span className="text-sm">
          <span className="text-text-primary">{tr('Require approval before publishing')}</span>
          <span className="block text-xs text-text-tertiary">{tr('Posts wait in the LinkedIn queue below until a company admin approves them. On by default for Company Pages.')}</span>
        </span>
      </label>
    </fieldset>
  );
}

type WebhookGuide = { title: string; steps: React.ReactNode[]; notes: React.ReactNode[] };

/* Full sentences per language: these mix text with links and bold UI names
   (which stay as the platforms show them, in English). */
function webhookSteps(type: Exclude<ChannelType, 'email'>): WebhookGuide {
  const es = getLang() === 'es';
  const mono = (s: string) => <span className="font-jetbrains">{s}</span>;
  if (type === 'discord') {
    return es ? {
      title: 'Cómo obtener la URL del webhook de Discord',
      steps: [
        <>En Discord, abre el servidor y entra en <b>Editar canal</b> (el engranaje junto al canal de texto).</>,
        <>Ve a <b>Integraciones</b> → <b>Webhooks</b> → <b>Nuevo webhook</b>.</>,
        <>Ponle un nombre (p. ej. “Security Alerts”) y, si quieres, un avatar. Verifica que el canal sea el correcto.</>,
        <>Haz clic en <b>Copiar URL del webhook</b> ({mono('https://discord.com/api/webhooks/…')}) y pégala abajo.</>,
      ],
      notes: [
        'Hace falta el permiso “Gestionar webhooks” en ese canal.',
        'CyberPulse nunca menciona a @everyone ni a nadie, y no genera vistas previas de los enlaces.',
      ],
    } : {
      title: 'How to get a Discord webhook URL',
      steps: [
        <>In Discord, open the server and click <b>Edit Channel</b> (the gear next to the text channel).</>,
        <>Go to <b>Integrations</b> → <b>Webhooks</b> → <b>New Webhook</b>.</>,
        <>Name it (e.g. “Security Alerts”) and optionally set an avatar. Check it posts to the right channel.</>,
        <>Click <b>Copy Webhook URL</b> ({mono('https://discord.com/api/webhooks/…')}) and paste it below.</>,
      ],
      notes: [
        'You need the “Manage Webhooks” permission on that channel.',
        'CyberPulse never pings @everyone or anyone else, and suppresses link previews.',
      ],
    };
  }
  if (type === 'telegram') {
    return es ? {
      title: 'Cómo crear el bot de Telegram y obtener el chat ID',
      steps: [
        <>En Telegram, abre <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-accent underline">@BotFather</a>, envía {mono('/newbot')} y sigue los pasos. Copia el <b>token</b> que te da ({mono('123456789:AA…')}).</>,
        <>Agrega el bot al grupo, o como <b>administrador</b> al canal, donde quieras recibir las alertas.</>,
        <>Chat ID: en un canal público puedes usar {mono('@nombredelcanal')}. Para grupos o canales privados, envía un mensaje en el chat y abre {mono('https://api.telegram.org/bot<TOKEN>/getUpdates')}: el número de {mono('"chat":{"id":…}')} (empieza con {mono('-100')}) es el chat ID.</>,
        <>Pega el token y el chat ID abajo y usa <b>Probar</b> para confirmar.</>,
      ],
      notes: [
        'En grupos, si el bot no ve los mensajes para getUpdates, desactiva su “privacy mode” en @BotFather (/setprivacy) o menciónalo.',
        'Usa un bot propio para CyberPulse; no reutilices el token de otro bot.',
      ],
    } : {
      title: 'How to create the Telegram bot and get the chat ID',
      steps: [
        <>In Telegram, open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-accent underline">@BotFather</a>, send {mono('/newbot')} and follow the steps. Copy the <b>token</b> it gives you ({mono('123456789:AA…')}).</>,
        <>Add the bot to the group, or as an <b>administrator</b> to the channel, where alerts should go.</>,
        <>Chat ID: for a public channel you can use {mono('@channelname')}. For groups or private channels, send a message in the chat and open {mono('https://api.telegram.org/bot<TOKEN>/getUpdates')}: the number in {mono('"chat":{"id":…}')} (starts with {mono('-100')}) is the chat ID.</>,
        <>Paste the token and the chat ID below and use <b>Test</b> to confirm.</>,
      ],
      notes: [
        'In groups, if the bot does not see messages for getUpdates, turn off its privacy mode in @BotFather (/setprivacy) or mention it.',
        'Use a dedicated bot for CyberPulse; do not reuse another bot’s token.',
      ],
    };
  }
  if (type === 'slack') {
    return es ? {
      title: 'Cómo obtener la URL del webhook de Slack',
      steps: [
        <>Abre <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent underline">api.slack.com/apps</a> y haz clic en <b>Create New App</b> → <b>From scratch</b> → <b>Pick features</b>.</>,
        <>En <b>Bot scopes</b> añade solo {mono('incoming-webhook')}. Deja <b>User scopes</b> vacío.</>,
        <>Ponle un nombre a la app (p. ej. “Security Alerts”), elige el workspace y créala.</>,
        <>En el menú de la izquierda abre <b>Incoming Webhooks</b>, actívalo (<b>On</b>) y haz clic en <b>Add New Webhook</b>.</>,
        <>Elige el canal y haz clic en <b>Allow</b>.</>,
        <>Copia la <b>Webhook URL</b> ({mono('https://hooks.slack.com/services/…')}) y pégala abajo.</>,
      ],
      notes: [
        'Si tu workspace exige aprobar las apps, un admin de Slack tiene que aprobar la instalación.',
        'Los canales privados solo aparecen si eres miembro.',
        'Opcional: el ícono y el nombre de la app se configuran en Basic Information → Display Information; es lo que el canal muestra como remitente.',
      ],
    } : {
      title: 'How to get a Slack webhook URL',
      steps: [
        <>Open <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-accent underline">api.slack.com/apps</a> and click <b>Create New App</b> → <b>From scratch</b> → <b>Pick features</b>.</>,
        <>Under <b>Bot scopes</b> add only {mono('incoming-webhook')}. Leave <b>User scopes</b> empty.</>,
        <>Give the app a name (e.g. “Security Alerts”), choose the workspace and create it.</>,
        <>In the left menu open <b>Incoming Webhooks</b>, switch it <b>On</b> and click <b>Add New Webhook</b>.</>,
        <>Pick the channel and click <b>Allow</b>.</>,
        <>Copy the <b>Webhook URL</b> ({mono('https://hooks.slack.com/services/…')}) and paste it below.</>,
      ],
      notes: [
        'If your workspace requires app approval, a Slack admin has to approve the install.',
        'Private channels only show up if you are a member.',
        'Optional: set the app icon and name under Basic Information → Display Information; that is what the channel shows as the sender.',
      ],
    };
  }
  return es ? {
    title: 'Cómo obtener la URL del webhook de Rocket.Chat',
    steps: [
      <>Inicia sesión con un usuario que pueda gestionar integraciones (normalmente un admin).</>,
      <>Ve a <b>Administration</b> (Workspace) → <b>Integrations</b> → <b>New</b> → <b>Incoming</b>.</>,
      <>Activa <b>Enabled</b> y ponle un nombre (p. ej. “Security Alerts”).</>,
      <>En <b>Post to Channel</b> escribe el canal ({mono('#security-alerts')}) y en <b>Post as</b> un usuario existente, p. ej. un bot o {mono('rocket.cat')}.</>,
      <>Opcional: con <b>Alias</b> y <b>Avatar URL</b> eliges cómo se ve el remitente. Deja <b>Script</b> desactivado.</>,
      <>Haz clic en <b>Save</b>, copia la <b>Webhook URL</b> ({mono('https://chat.example.com/hooks/…')}) y pégala abajo.</>,
    ],
    notes: [
      'El usuario de “Post as” tiene que ser miembro del canal.',
      'El servidor de Rocket.Chat tiene que ser accesible por HTTPS desde internet. Si está en una red privada, hace falta CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS del lado de CyberPulse (pídeselo a Hacker-Do).',
    ],
  } : {
    title: 'How to get a Rocket.Chat webhook URL',
    steps: [
      <>Log in as a user with permission to manage integrations (usually an admin).</>,
      <>Go to <b>Administration</b> (Workspace) → <b>Integrations</b> → <b>New</b> → <b>Incoming</b>.</>,
      <>Turn <b>Enabled</b> on and give it a name (e.g. “Security Alerts”).</>,
      <>In <b>Post to Channel</b> type the channel ({mono('#security-alerts')}) and in <b>Post as</b> an existing user, e.g. a bot user or {mono('rocket.cat')}.</>,
      <>Optional: set <b>Alias</b> and <b>Avatar URL</b> to choose how the sender looks. Leave <b>Script</b> disabled.</>,
      <>Click <b>Save</b>, then copy the <b>Webhook URL</b> ({mono('https://chat.example.com/hooks/…')}) and paste it below.</>,
    ],
    notes: [
      'The “Post as” user must be a member of the channel.',
      'The Rocket.Chat server must be reachable over HTTPS from the internet. Servers on a private network need CYBERPULSE_ALLOW_PRIVATE_WEBHOOKS on the CyberPulse side (ask Hacker-Do).',
    ],
  };
}

function WebhookHelp({ type, defaultOpen }: { type: Exclude<ChannelType, 'email'>; defaultOpen: boolean }) {
  const h = webhookSteps(type);
  return (
    <details className="group rounded-lg border border-border-default bg-bg-elevated/40 px-4 py-3 text-xs" open={defaultOpen}>
      <summary className="cursor-pointer select-none font-medium text-text-secondary">{h.title}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-secondary">
        {h.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <ul className="mt-2 space-y-0.5 text-text-tertiary">
        {h.notes.map((n, i) => <li key={i}>· {n}</li>)}
      </ul>
      <p className="mt-2 text-text-tertiary">{type === 'telegram' ? tr('The bot token works like a password: anyone who has it controls the bot. Don’t share it by chat or email.') : tr("The URL works like a password: anyone who has it can post to the channel. Don’t share it by chat or email.")}</p>
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
      <Field label={tr("Recipients")} htmlFor="ch-rcpt" hint={tr('One per line (or comma-separated), up to 20. Each recipient gets their own copy and never sees the others.') + (count ? ' ' + tr('{n} entered.', { n: count }) : '')}>
        <Textarea id="ch-rcpt" rows={3} value={recipients} onChange={(e) => onRecipients(e.target.value)} className={`${inputCls} font-jetbrains text-xs resize-y`} placeholder={'soc@company.com\nit-team@company.com'} required />
      </Field>

      <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
        <legend className="px-1 text-xs font-medium text-text-secondary">{tr("SMTP server")}</legend>
        <details className="rounded-lg border border-border-default bg-bg-elevated/40 px-4 py-3 text-xs" open={defaultOpen}>
          <summary className="cursor-pointer select-none font-medium text-text-secondary">{tr("How to send through Gmail / Google Workspace")}</summary>
          {getLang() === 'es' ? (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-secondary">
                <li>Activa la verificación en 2 pasos en la cuenta de Google que va a enviar.</li>
                <li>Abre <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent underline">myaccount.google.com/apppasswords</a>, crea una contraseña de aplicación (p. ej. “CyberPulse”) y copia las 16 letras.</li>
                <li>Servidor <span className="font-jetbrains">smtp.gmail.com</span>, puerto <span className="font-jetbrains">587</span>, STARTTLS, usuario = la dirección de Gmail completa, contraseña = la contraseña de aplicación.</li>
                <li>Para enviar como otra dirección (p. ej. alertas@tudominio), primero añádela en Gmail → Configuración → Cuentas → “Enviar como”.</li>
              </ol>
              <p className="mt-2 text-text-tertiary">Otros proveedores funcionan igual (Microsoft 365: smtp.office365.com, 587, STARTTLS). Solo se aceptan servidores públicos en los puertos 25, 465, 587 o 2525 con TLS.</p>
            </>
          ) : (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-secondary">
                <li>Turn on 2-Step Verification on the Google account that will send.</li>
                <li>Open <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent underline">myaccount.google.com/apppasswords</a>, create an app password named e.g. “CyberPulse” and copy the 16 letters.</li>
                <li>Server <span className="font-jetbrains">smtp.gmail.com</span>, port <span className="font-jetbrains">587</span>, STARTTLS, user = the full Gmail address, password = the app password.</li>
                <li>To send as another address (e.g. alerts@yourdomain), add it first in Gmail → Settings → Accounts → “Send mail as”.</li>
              </ol>
              <p className="mt-2 text-text-tertiary">Other providers work the same way (Microsoft 365: smtp.office365.com, 587, STARTTLS). Only public servers on ports 25, 465, 587 or 2525 with TLS are accepted.</p>
            </>
          )}
        </details>
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem_9rem]">
          <Field label={tr("Server")} htmlFor="ch-smtp-host">
            <Input id="ch-smtp-host" value={smtp.host} onChange={(e) => set({ host: e.target.value })} className={`${inputCls} font-jetbrains text-xs`} placeholder={tr("smtp.gmail.com")} required />
          </Field>
          <Field label={tr("Port")} htmlFor="ch-smtp-port">
            <select id="ch-smtp-port" className={selectCls} value={smtp.port}
              onChange={(e) => { const port = Number(e.target.value); set({ port, security: port === 465 ? 'tls' : 'starttls' }); }}>
              {[587, 465, 2525, 25].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label={tr("Security")} htmlFor="ch-smtp-sec">
            <select id="ch-smtp-sec" className={selectCls} value={smtp.security} onChange={(e) => set({ security: e.target.value as SmtpForm['security'] })}>
              <option value="starttls">{tr("STARTTLS")}</option>
              <option value="tls">{tr("TLS (SSL)")}</option>
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tr("User")} htmlFor="ch-smtp-user">
            <Input id="ch-smtp-user" autoComplete="off" value={smtp.user} onChange={(e) => set({ user: e.target.value })} className={inputCls} placeholder={tr("alerts@company.com")} required />
          </Field>
          <Field label={tr("Password")} htmlFor="ch-smtp-pass" hint={passwordSaved ? tr('Saved. Leave empty to keep it.') : tr('Stored encrypted, never shown again.')}>
            <Input id="ch-smtp-pass" type="password" autoComplete="new-password" value={smtp.password} onChange={(e) => set({ password: e.target.value })} className={inputCls} placeholder={passwordSaved ? '••••••••' : tr('App password')} required={!passwordSaved} />
          </Field>
          <Field label={tr("Sender address")} htmlFor="ch-smtp-from" hint={tr("Empty = the SMTP user.")}>
            <Input id="ch-smtp-from" type="email" value={smtp.fromAddress} onChange={(e) => set({ fromAddress: e.target.value })} className={inputCls} placeholder={tr("alerts@company.com")} />
          </Field>
          <Field label={tr("Sender name")} htmlFor="ch-smtp-name">
            <Input id="ch-smtp-name" value={smtp.fromName} onChange={(e) => set({ fromName: e.target.value })} className={inputCls} maxLength={80} placeholder={tr("Security Alerts")} />
          </Field>
        </div>
      </fieldset>
    </>
  );
}

function EmailMessageFields({ f, setF }: { f: ChannelInput; setF: (v: ChannelInput) => void }) {
  return (
    <fieldset className="space-y-3 border border-border-default rounded-lg p-4">
      <legend className="px-1 text-xs font-medium text-text-secondary">{tr("Message")}</legend>
      <Field
        label={tr("Subject")}
        htmlFor="ch-subject"
        hint={<>{tr("Leave empty for the default.")} <span className="font-jetbrains">{'{company}'}</span> {tr("and")} <span className="font-jetbrains">{'{count}'}</span> {tr("work here and in the HTML below.")}</>}
      >
        <Input id="ch-subject" value={f.header ?? ''} onChange={(e) => setF({ ...f, header: e.target.value })} className={inputCls} maxLength={150}
          placeholder={tr("Hacker-Do CyberPulse · {company} · {count} security updates for your stack")} />
      </Field>
      <Field label={tr("Header (HTML)")} htmlFor="ch-hhtml" hint={tr("Shown above the news. Empty = the subject as a title. Images by https URL, e.g. your hosted logo.")}>
        <Textarea id="ch-hhtml" rows={4} value={f.headerHtml ?? ''} onChange={(e) => setF({ ...f, headerHtml: e.target.value })} className={`${inputCls} font-jetbrains text-xs resize-y`} maxLength={10000}
          placeholder={'<img src="https://company.com/logo.png" alt="Company" width="140">\n<h2>Security briefing for {company}</h2>'} />
      </Field>
      <label className="flex items-center gap-3 cursor-pointer">
        <Switch checked={f.footerHtml !== ''} onCheckedChange={(v) => setF({ ...f, footerHtml: v ? null : '' })} />
        <span className="text-sm text-text-primary">{tr("Show footer")}</span>
      </label>
      {f.footerHtml !== '' && (
        <Field label={tr("Footer (HTML)")} htmlFor="ch-fhtml" hint={tr("Empty = the default footer.")}>
          <Textarea id="ch-fhtml" rows={3} value={f.footerHtml ?? ''} onChange={(e) => setF({ ...f, footerHtml: e.target.value === '' ? null : e.target.value })} className={`${inputCls} font-jetbrains text-xs resize-y`} maxLength={10000}
            placeholder={'<p>Company SOC · <a href="https://company.com">company.com</a></p>'} />
        </Field>
      )}
      <EmailPreview header={f.header ?? null} headerHtml={f.headerHtml ?? null} footerHtml={f.footerHtml ?? null} />
      <p className="text-xs text-text-tertiary">{tr("Scripts, forms and external styles are removed when saving; the preview shows exactly what will be sent. Use Test after saving to check it in a real inbox.")}</p>
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
      <div className="text-xs font-medium text-text-secondary mb-1.5">{tr("Preview (sample news)")}</div>
      {/* No scripts, no same-origin: the HTML cannot touch the app. */}
      <iframe title={tr("Email preview")} sandbox="" srcDoc={html} className="w-full h-[420px] rounded-md border border-border-default bg-white" />
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
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">{tr("Delivery history ·")} {channel?.name}</DialogTitle></DialogHeader>
        {rows === null ? <p className="text-sm text-text-tertiary">{tr("Loading…")}</p> : rows.length === 0 ? (
          <EmptyState>{tr("Nothing sent yet.")}</EmptyState>
        ) : (
          <ul className="divide-y divide-border-default">
            {rows.map((d) => (
              <li key={d.id} className="py-2.5 flex items-start gap-3 text-sm">
                <span className="w-32 shrink-0 text-xs text-text-tertiary font-jetbrains">{formatDateTime(d.createdAt, timeZone)}</span>
                <Badge tone={tone(d.status)}>{d.status}</Badge>
                <span className="text-text-secondary text-xs flex-1 break-words">
                  {d.trigger === 'manual' ? tr('Manual · ') : ''}{d.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

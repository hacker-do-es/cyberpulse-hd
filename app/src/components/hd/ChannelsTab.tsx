import { useCallback, useEffect, useState } from 'react';
import { History, Pencil, Plus, Radio, Send, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { channelsApi, type Channel, type ChannelInput, type Delivery, type Severity } from '@/services/hdApi';
import { useAuth } from '@/lib/auth';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { inputCls, selectCls, notifyError, formatDateTime, WEEKDAYS } from './helpers';

const SEVERITY_LABEL: Record<Severity, string> = { low: 'Low and above', medium: 'Medium and above', high: 'High and above', critical: 'Critical only' };
const TYPE_LABEL = { slack: 'Slack', rocketchat: 'Rocket.Chat' } as const;

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
        description="Slack and Rocket.Chat incoming webhooks. Articles are never sent twice to the same channel; when nothing new matches, nothing is sent."
        actions={<Button size="sm" onClick={() => setEditing('new')}><Plus size={14} /> New channel</Button>}
      >
        {loading ? (
          <p className="text-sm text-text-tertiary">Loading…</p>
        ) : channels.length === 0 ? (
          <EmptyState>No channels yet. Add a Slack or Rocket.Chat webhook to start sending digests.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {channels.map((c) => (
              <li key={c.id} className={`border border-border-default rounded-lg p-4 ${c.active ? '' : 'opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-rajdhani text-base font-semibold text-text-primary">{c.name}</span>
                      <Badge tone="accent">{TYPE_LABEL[c.type]}</Badge>
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

const EMPTY: ChannelInput = {
  name: '', type: 'slack', webhookUrl: '', active: true,
  schedule: { type: 'weekly', intervalHours: 6, timeOfDay: '08:30', weekdays: [1, 2, 3, 4, 5] },
  minSeverity: 'medium', maxItems: 15, useAi: true,
};

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

  useEffect(() => {
    if (channel === null) return;
    if (channel === 'new') {
      setF(EMPTY);
      setPreset('weekdays');
    } else {
      setF({ ...toInput(channel), webhookUrl: '' });
      setPreset(presetOf(channel.schedule));
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
      const payload: ChannelInput = { ...f, webhookUrl: f.webhookUrl?.trim() || undefined };
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
            {f.type === 'slack'
              ? 'In Slack: Apps → Incoming Webhooks → Add to channel, then paste the https://hooks.slack.com/services/… URL.'
              : 'In Rocket.Chat: Administration → Integrations → New → Incoming, pick the channel, save and paste the Webhook URL.'}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="ch-name">
              <Input id="ch-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="#security-alerts" required maxLength={80} />
            </Field>
            <Field label="Platform" htmlFor="ch-type">
              <select id="ch-type" className={selectCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as ChannelInput['type'] })}>
                <option value="slack">Slack</option>
                <option value="rocketchat">Rocket.Chat</option>
              </select>
            </Field>
          </div>

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

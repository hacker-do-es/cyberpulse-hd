import { useCallback, useEffect, useState } from 'react';
import { Bot, Building2, KeyRound, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { COMPANY_ROLES, settingsApi, usersApi, type CompanyRole, type TenantSettings, type TenantUser } from '@/services/hdApi';
import { useAuth, useCan } from '@/lib/auth';
import { companyRoleHint, roleLabel } from './roleLabels';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { inputCls, selectCls, notifyError, formatDateTime, TIMEZONES } from './helpers';
import { tr } from '@/lib/i18n';

export default function SettingsTab() {
  const { me } = useAuth();
  const can = useCan();

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader
        title={`${me?.activeTenant?.name ?? tr('Company')} · ${tr('Settings')}`}
        subtitle={tr('Language, time zone, AI provider and users of this company.')}
      />
      <div className="space-y-6">
        {can('settings.manage') && <CompanyAndAi />}
        {can('users.manage') && <UsersPanel />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Company preferences + AI provider                                  */
/* ------------------------------------------------------------------ */

function CompanyAndAi() {
  const { refresh } = useAuth();
  const [s, setS] = useState<TenantSettings | null>(null);
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [timezone, setTimezone] = useState('Europe/Madrid');
  const [provider, setProvider] = useState<'none' | 'anthropic' | 'openai'>('none');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const apply = (d: TenantSettings) => {
    setS(d);
    setLanguage(d.language);
    setTimezone(d.timezone);
    setProvider(d.ai.provider);
    setModel(d.ai.model);
    setBaseUrl(d.ai.baseUrl);
    setApiKey('');
  };

  useEffect(() => {
    settingsApi.get().then(apply).catch((err) => notifyError(err));
  }, []);

  const changeProvider = (p: 'none' | 'anthropic' | 'openai') => {
    setProvider(p);
    if (!s) return;
    setModel(p === 'anthropic' ? s.options.anthropicModels[0] : p === 'openai' ? s.options.defaultOpenAiModel : '');
  };

  const save = async () => {
    setSaving(true);
    try {
      const d = await settingsApi.update({
        language,
        timezone,
        ai: {
          provider,
          model: provider === 'none' ? undefined : model,
          baseUrl: provider === 'openai' ? baseUrl : undefined,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        },
      });
      apply(d);
      await refresh();
      toast.success(tr("Settings saved"));
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    try {
      apply(await settingsApi.update({ ai: { apiKey: '' } }));
      await refresh();
      toast.success(tr("API key removed"));
    } catch (err) {
      notifyError(err);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await settingsApi.testAi();
      toast.success(tr('{provider} ({model}) answered correctly', { provider: r.provider === 'anthropic' ? 'Claude' : 'OpenAI', model: r.model }));
    } catch (err) {
      notifyError(err);
    } finally {
      setTesting(false);
    }
  };

  if (!s) return null;
  const providerChanged = provider !== s.ai.provider;

  return (
    <Panel
      title={tr("Company & AI")}
      icon={<Bot size={18} />}
      description={tr("Language and time zone apply to channel digests and schedules. The AI key writes the digest summaries and the AI posts; it is stored encrypted and never shown again.")}
      actions={
        <>
          {s.ai.keySet && s.ai.provider !== 'none' && (
            <Button size="sm" variant="outline" className="border-border-default bg-transparent text-text-secondary" disabled={testing} onClick={() => void test()}>
              {testing ? tr('Testing…') : tr('Test connection')}
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? tr('Saving…') : tr('Save')}</Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label={tr("Digest language")} htmlFor="lang">
          <select id="lang" className={selectCls} value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
            <option value="es">{tr("Español")}</option>
            <option value="en">{tr("English")}</option>
          </select>
        </Field>
        <Field label={tr("Time zone")} htmlFor="tz">
          <select id="tz" className={selectCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {[...new Set([timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>

        <Field label={tr("AI provider")} htmlFor="provider">
          <select id="provider" className={selectCls} value={provider} onChange={(e) => changeProvider(e.target.value as 'none' | 'anthropic' | 'openai')}>
            <option value="none">{tr("None (templates only)")}</option>
            <option value="anthropic">{tr("Claude (Anthropic)")}</option>
            <option value="openai">{tr("ChatGPT (OpenAI)")}</option>
          </select>
        </Field>

        {provider === 'anthropic' && (
          <Field label={tr("Model")} htmlFor="model" hint={tr("Opus gives the best summaries; Haiku is the cheapest.")}>
            <select id="model" className={selectCls} value={model} onChange={(e) => setModel(e.target.value)}>
              {s.options.anthropicModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        {provider === 'openai' && (
          <Field label={tr("Model")} htmlFor="model">
            <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} placeholder={s.options.defaultOpenAiModel} />
          </Field>
        )}

        {provider !== 'none' && (
          <Field
            label={tr("API key")}
            htmlFor="apikey"
            hint={
              s.ai.keySet && !providerChanged
                ? <>{tr("Saved key:")} <span className="font-jetbrains">{s.ai.keyHint}</span>{tr(". Leave empty to keep it.")}</>
                : provider === 'anthropic' ? tr('Create one at console.anthropic.com → API keys.') : tr('Create one at platform.openai.com → API keys.')
            }
          >
            <div className="flex gap-2">
              <Input
                id="apikey"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={`${inputCls} font-jetbrains`}
                placeholder={provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
              />
              {s.ai.keySet && !providerChanged && (
                <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => void removeKey()} aria-label={tr("Remove saved key")}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </Field>
        )}

        {provider === 'openai' && (
          <Field label={tr("Base URL (optional)")} htmlFor="baseurl" hint={tr("Only for OpenAI-compatible endpoints on the server allowlist.")}>
            <Input id="baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://api.openai.com/v1" />
          </Field>
        )}
      </div>
      {providerChanged && s.ai.keySet && !apiKey && provider !== 'none' && (
        <p className="mt-4 text-xs text-medium">{tr("Switching provider discards the saved key: paste the key for the new provider.")}</p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/*  Users of this company                                              */
/* ------------------------------------------------------------------ */

function UsersPanel() {
  const { me } = useAuth();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<TenantUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await usersApi.list());
    } catch (err) {
      notifyError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = async (u: TenantUser, patch: Parameters<typeof usersApi.update>[1], msg: string) => {
    try {
      await usersApi.update(u.id, patch);
      toast.success(msg);
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  const remove = async (u: TenantUser) => {
    if (!window.confirm(tr('Delete user "{name}"? This cannot be undone.', { name: u.username }))) return;
    try {
      await usersApi.remove(u.id);
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Panel
      title={tr("Users")}
      icon={<Users size={18} />}
      description={tr("Admins manage the stack, AI and channels. Members can read news and generate posts.")}
      actions={<Button size="sm" onClick={() => setCreateOpen(true)}><UserPlus size={14} /> {tr("New user")}</Button>}
    >
      {users.length === 0 ? (
        <EmptyState>{tr("No users in this company yet.")}</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">{tr("User")}</th>
                <th className="px-3 py-2 font-medium">{tr("Role")}</th>
                <th className="px-3 py-2 font-medium">{tr("Status")}</th>
                <th className="px-3 py-2 font-medium">{tr("Last login")}</th>
                <th className="px-3 py-2"><span className="sr-only">{tr("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.user.id;
                return (
                  <tr key={u.id} className="border-t border-border-default">
                    <td className="px-3 py-2">
                      <div className="text-text-primary font-medium">{u.username}{self && <span className="text-text-tertiary font-normal"> {tr("(you)")}</span>}</div>
                      {u.displayName && <div className="text-xs text-text-tertiary">{u.displayName}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`${selectCls} h-8 w-36 text-xs`}
                        value={u.role}
                        disabled={self}
                        onChange={(e) => void update(u, { role: e.target.value as CompanyRole }, tr('Role updated'))}
                        aria-label={tr('Role of {name}', { name: u.username })}
                        title={companyRoleHint(u.role)}
                      >
                        {COMPANY_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 space-x-1">
                      {u.active ? <Badge tone="ok">{tr("Active")}</Badge> : <Badge tone="bad">{tr("Disabled")}</Badge>}
                      {u.totpEnabled && <Badge tone="accent"><ShieldCheck size={10} /> {tr("2FA")}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => setResetFor(u)} title={tr("Set a new password")}>
                          <KeyRound size={13} />
                        </Button>
                        {u.totpEnabled && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void update(u, { resetTotp: true }, tr('2FA removed'))}>
                            {tr("Reset 2FA")}
                          </Button>
                        )}
                        {!self && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void update(u, { active: !u.active }, u.active ? tr('User disabled') : tr('User enabled'))}>
                            {u.active ? tr('Disable') : tr('Enable')}
                          </Button>
                        )}
                        {!self && (
                          <Button size="sm" variant="ghost" className="h-7 text-text-tertiary hover:text-critical" onClick={() => void remove(u)} aria-label={tr('Delete {name}', { name: u.username })}>
                            <Trash2 size={13} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
    </Panel>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => Promise<void> }) {
  const [f, setF] = useState({ username: '', displayName: '', password: '', role: 'member' as CompanyRole });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await usersApi.create({ ...f, displayName: f.displayName || undefined });
      toast.success(tr('User {name} created', { name: f.username }));
      setF({ username: '', displayName: '', password: '', role: 'member' });
      onOpenChange(false);
      await onCreated();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
        <DialogHeader><DialogTitle className="font-rajdhani text-xl flex items-center gap-2"><Building2 size={18} className="text-accent" /> {tr("New user")}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr("Username")} htmlFor="nu-user" hint={tr("Letters, digits and . _ @ -")}>
            <Input id="nu-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className={inputCls} required />
          </Field>
          <Field label={tr("Full name (optional)")} htmlFor="nu-name">
            <Input id="nu-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} />
          </Field>
          <Field label={tr("Initial password")} htmlFor="nu-pw" hint={tr("At least 12 characters. Share it securely; they can change it after logging in.")}>
            <Input id="nu-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={inputCls} required minLength={12} />
          </Field>
          <Field label={tr("Role")} htmlFor="nu-role" hint={companyRoleHint(f.role)}>
            <select id="nu-role" className={selectCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as CompanyRole })}>
              {[...COMPANY_ROLES].reverse().map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? tr('Creating…') : tr('Create user')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: TenantUser | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await usersApi.update(user.id, { password: pw });
      toast.success(tr('Password updated for {name}; their sessions were closed', { name: user.username }));
      setPw('');
      onClose();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={user !== null} onOpenChange={(o) => { if (!o) { setPw(''); onClose(); } }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">{tr("New password for")} {user?.username}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr("Password")} htmlFor="rp-pw" hint={tr("At least 12 characters.")}>
            <Input id="rp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} required minLength={12} />
          </Field>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Set password')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

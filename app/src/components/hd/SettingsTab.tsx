import { useCallback, useEffect, useState } from 'react';
import { Bot, Building2, KeyRound, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { settingsApi, usersApi, type TenantSettings, type TenantUser } from '@/services/hdApi';
import { useAuth } from '@/lib/auth';
import StackManager from './StackManager';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { inputCls, selectCls, notifyError, formatDateTime, TIMEZONES } from './helpers';

export default function SettingsTab({ onStackChanged }: { onStackChanged?: () => void }) {
  const { me } = useAuth();
  const isAdmin = me?.user.role === 'admin' || me?.user.role === 'superadmin';

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader
        title={`${me?.activeTenant?.name ?? 'Company'} · Settings`}
        subtitle={isAdmin ? 'Stack, AI provider and users of this company.' : 'The technology stack your company monitors.'}
      />
      <div className="space-y-6">
        <StackManager canEdit={isAdmin} onChanged={onStackChanged} />
        {isAdmin && <CompanyAndAi />}
        {isAdmin && <UsersPanel />}
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
      toast.success('Settings saved');
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
      toast.success('API key removed');
    } catch (err) {
      notifyError(err);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await settingsApi.testAi();
      toast.success(`${r.provider === 'anthropic' ? 'Claude' : 'OpenAI'} (${r.model}) answered correctly`);
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
      title="Company & AI"
      icon={<Bot size={18} />}
      description="Language and time zone apply to channel digests and schedules. The AI key writes the digest summaries and the AI posts; it is stored encrypted and never shown again."
      actions={
        <>
          {s.ai.keySet && s.ai.provider !== 'none' && (
            <Button size="sm" variant="outline" className="border-border-default bg-transparent text-text-secondary" disabled={testing} onClick={() => void test()}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Digest language" htmlFor="lang">
          <select id="lang" className={selectCls} value={language} onChange={(e) => setLanguage(e.target.value as 'es' | 'en')}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </Field>
        <Field label="Time zone" htmlFor="tz">
          <select id="tz" className={selectCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {[...new Set([timezone, ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>

        <Field label="AI provider" htmlFor="provider">
          <select id="provider" className={selectCls} value={provider} onChange={(e) => changeProvider(e.target.value as 'none' | 'anthropic' | 'openai')}>
            <option value="none">None (templates only)</option>
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">ChatGPT (OpenAI)</option>
          </select>
        </Field>

        {provider === 'anthropic' && (
          <Field label="Model" htmlFor="model" hint="Opus gives the best summaries; Haiku is the cheapest.">
            <select id="model" className={selectCls} value={model} onChange={(e) => setModel(e.target.value)}>
              {s.options.anthropicModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        {provider === 'openai' && (
          <Field label="Model" htmlFor="model">
            <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} placeholder={s.options.defaultOpenAiModel} />
          </Field>
        )}

        {provider !== 'none' && (
          <Field
            label="API key"
            htmlFor="apikey"
            hint={
              s.ai.keySet && !providerChanged
                ? <>Saved key: <span className="font-jetbrains">{s.ai.keyHint}</span>. Leave empty to keep it.</>
                : provider === 'anthropic' ? 'Create one at console.anthropic.com → API keys.' : 'Create one at platform.openai.com → API keys.'
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
                <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => void removeKey()} aria-label="Remove saved key">
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          </Field>
        )}

        {provider === 'openai' && (
          <Field label="Base URL (optional)" htmlFor="baseurl" hint="Only for OpenAI-compatible endpoints on the server allowlist.">
            <Input id="baseurl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://api.openai.com/v1" />
          </Field>
        )}
      </div>
      {providerChanged && s.ai.keySet && !apiKey && provider !== 'none' && (
        <p className="mt-4 text-xs text-medium">Switching provider discards the saved key: paste the key for the new provider.</p>
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
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await usersApi.remove(u.id);
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Panel
      title="Users"
      icon={<Users size={18} />}
      description="Admins manage the stack, AI and channels. Members can read news and generate posts."
      actions={<Button size="sm" onClick={() => setCreateOpen(true)}><UserPlus size={14} /> New user</Button>}
    >
      {users.length === 0 ? (
        <EmptyState>No users in this company yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last login</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.user.id;
                return (
                  <tr key={u.id} className="border-t border-border-default">
                    <td className="px-3 py-2">
                      <div className="text-text-primary font-medium">{u.username}{self && <span className="text-text-tertiary font-normal"> (you)</span>}</div>
                      {u.displayName && <div className="text-xs text-text-tertiary">{u.displayName}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={`${selectCls} h-8 w-28 text-xs`}
                        value={u.role}
                        disabled={self}
                        onChange={(e) => void update(u, { role: e.target.value as 'admin' | 'member' }, 'Role updated')}
                        aria-label={`Role of ${u.username}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 space-x-1">
                      {u.active ? <Badge tone="ok">Active</Badge> : <Badge tone="bad">Disabled</Badge>}
                      {u.totpEnabled && <Badge tone="accent"><ShieldCheck size={10} /> 2FA</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-secondary">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => setResetFor(u)} title="Set a new password">
                          <KeyRound size={13} />
                        </Button>
                        {u.totpEnabled && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void update(u, { resetTotp: true }, '2FA removed')}>
                            Reset 2FA
                          </Button>
                        )}
                        {!self && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void update(u, { active: !u.active }, u.active ? 'User disabled' : 'User enabled')}>
                            {u.active ? 'Disable' : 'Enable'}
                          </Button>
                        )}
                        {!self && (
                          <Button size="sm" variant="ghost" className="h-7 text-text-tertiary hover:text-critical" onClick={() => void remove(u)} aria-label={`Delete ${u.username}`}>
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
  const [f, setF] = useState({ username: '', displayName: '', password: '', role: 'member' as 'admin' | 'member' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await usersApi.create({ ...f, displayName: f.displayName || undefined });
      toast.success(`User ${f.username} created`);
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
        <DialogHeader><DialogTitle className="font-rajdhani text-xl flex items-center gap-2"><Building2 size={18} className="text-accent" /> New user</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Username" htmlFor="nu-user" hint="Letters, digits and . _ @ -">
            <Input id="nu-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className={inputCls} required />
          </Field>
          <Field label="Full name (optional)" htmlFor="nu-name">
            <Input id="nu-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Initial password" htmlFor="nu-pw" hint="At least 12 characters. Share it securely; they can change it after logging in.">
            <Input id="nu-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={inputCls} required minLength={12} />
          </Field>
          <Field label="Role" htmlFor="nu-role">
            <select id="nu-role" className={selectCls} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'admin' | 'member' })}>
              <option value="member">Member (read-only)</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</Button>
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
      toast.success(`Password updated for ${user.username}; their sessions were closed`);
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
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">New password for {user?.username}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label="Password" htmlFor="rp-pw" hint="At least 12 characters.">
            <Input id="rp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} required minLength={12} />
          </Field>
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

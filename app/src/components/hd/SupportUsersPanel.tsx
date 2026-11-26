import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LifeBuoy, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supportUsersApi, type SupportUser } from '@/services/hdApi';
import { Panel, Field, Badge, EmptyState } from './ui';
import { inputCls, notifyError, formatDateTime } from './helpers';
import { tr } from '@/lib/i18n';

/* Superadmin: Hacker-Do support accounts. They pick a company in the header
   and work there as operators; they cannot manage companies, feeds or users. */
export default function SupportUsersPanel() {
  const [users, setUsers] = useState<SupportUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<SupportUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await supportUsersApi.list());
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (u: SupportUser, changes: Parameters<typeof supportUsersApi.update>[1], ok: string) => {
    try {
      await supportUsersApi.update(u.id, changes);
      toast.success(ok);
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  const remove = async (u: SupportUser) => {
    if (!window.confirm(tr('Delete support user "{name}"?', { name: u.username }))) return;
    try {
      await supportUsersApi.remove(u.id);
      toast.success(tr('User deleted'));
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Panel
      title={tr('Support users')}
      icon={<LifeBuoy size={18} />}
      description={tr('Hacker-Do staff. They pick a company and work there as operators (stack, assets, agents, running channels) and can read the logs. They cannot manage companies, feeds, users or integrations.')}
      actions={<Button size="sm" onClick={() => setCreateOpen(true)}><UserPlus size={14} /> {tr('New support user')}</Button>}
    >
      {loading ? <p className="text-sm text-text-tertiary">{tr('Loading…')}</p> : users.length === 0 ? (
        <EmptyState>{tr('No support users yet.')}</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">{tr('User')}</th>
                <th className="px-3 py-2 font-medium">{tr('Status')}</th>
                <th className="px-3 py-2 font-medium">{tr('Last login')}</th>
                <th className="px-3 py-2"><span className="sr-only">{tr('Actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border-default">
                  <td className="px-3 py-2">
                    <div className="text-text-primary font-medium">{u.username}</div>
                    {u.displayName && <div className="text-xs text-text-tertiary">{u.displayName}</div>}
                  </td>
                  <td className="px-3 py-2 space-x-1">
                    {u.active ? <Badge tone="ok">{tr('Active')}</Badge> : <Badge tone="bad">{tr('Disabled')}</Badge>}
                    {u.totpEnabled && <Badge tone="accent"><ShieldCheck size={10} /> {tr('2FA')}</Badge>}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-secondary">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end items-center gap-1">
                      <Switch checked={u.active} onCheckedChange={(v) => void update(u, { active: v }, v ? tr('User enabled') : tr('User disabled'))}
                        aria-label={u.active ? tr('Disable {name}', { name: u.username }) : tr('Enable {name}', { name: u.username })} />
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => setResetFor(u)} title={tr('Set a new password')}>
                        <KeyRound size={13} />
                      </Button>
                      {u.totpEnabled && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void update(u, { resetTotp: true }, tr('2FA reset'))}>
                          {tr('Reset 2FA')}
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" onClick={() => void remove(u)} aria-label={tr('Delete {name}', { name: u.username })}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
      <PasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
    </Panel>
  );
}

function CreateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => Promise<void> }) {
  const [f, setF] = useState({ username: '', displayName: '', password: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await supportUsersApi.create({ ...f, displayName: f.displayName || undefined });
      toast.success(tr('User {name} created', { name: f.username }));
      setF({ username: '', displayName: '', password: '' });
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
        <DialogHeader><DialogTitle className="font-rajdhani text-xl flex items-center gap-2"><LifeBuoy size={18} className="text-accent" /> {tr('New support user')}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr('Username')} htmlFor="su-user" hint={tr('Letters, digits and . _ @ -')}>
            <Input id="su-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className={inputCls} required />
          </Field>
          <Field label={tr('Full name (optional)')} htmlFor="su-name">
            <Input id="su-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} />
          </Field>
          <Field label={tr('Initial password')} htmlFor="su-pw" hint={tr('At least 12 characters. Share it securely; they can change it after logging in.')}>
            <Input id="su-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={inputCls} required minLength={12} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? tr('Creating…') : tr('Create user')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ user, onClose }: { user: SupportUser | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await supportUsersApi.update(user.id, { password: pw });
      toast.success(tr('Password updated'));
      setPw('');
      onClose();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={user !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">{tr('New password for {name}', { name: user?.username ?? '' })}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr('New password')} htmlFor="su-newpw" hint={tr('At least 12 characters. Their open sessions are closed.')}>
            <Input id="su-newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} required minLength={12} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

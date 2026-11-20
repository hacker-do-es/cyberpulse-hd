import { useCallback, useEffect, useState } from 'react';
import { Building2, LogIn, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminApi, type TenantSummary } from '@/services/hdApi';
import { useAuth } from '@/lib/auth';
import { Panel, PageHeader, Field, Badge, EmptyState } from './ui';
import { inputCls, selectCls, notifyError, formatDateTime, TIMEZONES } from './helpers';
import { tr } from '@/lib/i18n';

export default function AdminTab({ onEnterTenant }: { onEnterTenant: () => void }) {
  const { me, switchTenant, refresh } = useAuth();
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renaming, setRenaming] = useState<TenantSummary | null>(null);
  const [deleting, setDeleting] = useState<TenantSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setTenants(await adminApi.list());
    } catch (err) {
      notifyError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = async (t: TenantSummary) => {
    try {
      await switchTenant(t.id);
      onEnterTenant();
    } catch (err) {
      notifyError(err);
    }
  };

  const toggle = async (t: TenantSummary) => {
    if (t.active && !window.confirm(tr('Disable "{name}"? Its users are logged out and its channels stop sending.', { name: t.name }))) return;
    try {
      await adminApi.update(t.id, { active: !t.active });
      await load();
      await refresh();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader title={tr("Companies")} subtitle={tr("Hacker-Do superadmin. Each company has its own stack, AI key, users and channels.")} />
      <Panel
        title={tenants.length === 1 ? tr('1 company') : tr('{n} companies', { n: tenants.length })}
        icon={<Building2 size={18} />}
        actions={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus size={14} /> {tr("New company")}</Button>}
      >
        {loading ? <p className="text-sm text-text-tertiary">{tr("Loading…")}</p> : tenants.length === 0 ? (
          <EmptyState>{tr("No companies yet. Create the first one and its admin user.")}</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-border-default rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                  <th className="px-3 py-2 font-medium">{tr("Company")}</th>
                  <th className="px-3 py-2 font-medium">{tr("Users")}</th>
                  <th className="px-3 py-2 font-medium">{tr("Stack")}</th>
                  <th className="px-3 py-2 font-medium">{tr("Channels")}</th>
                  <th className="px-3 py-2 font-medium">{tr("AI")}</th>
                  <th className="px-3 py-2 font-medium">{tr("Created")}</th>
                  <th className="px-3 py-2"><span className="sr-only">{tr("Actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-t border-border-default">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-text-primary font-medium">{t.name}</span>
                        {!t.active && <Badge tone="bad">{tr("Disabled")}</Badge>}
                        {me?.activeTenant?.id === t.id && <Badge tone="accent">{tr("Selected")}</Badge>}
                      </div>
                      <div className="text-[11px] text-text-tertiary">{t.timezone} · {t.language.toUpperCase()}</div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{t.counts.users}</td>
                    <td className="px-3 py-2 text-text-secondary">{t.counts.stack}</td>
                    <td className="px-3 py-2 text-text-secondary">{t.counts.channels}</td>
                    <td className="px-3 py-2 text-text-secondary text-xs">{t.aiProvider === 'anthropic' ? 'Claude' : t.aiProvider === 'openai' ? 'OpenAI' : '—'}</td>
                    <td className="px-3 py-2 text-xs text-text-tertiary">{formatDateTime(t.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-accent" onClick={() => void enter(t)}><LogIn size={13} /> {tr("Manage")}</Button>
                        <Button size="icon-sm" variant="ghost" className="text-text-secondary" onClick={() => setRenaming(t)} aria-label={tr('Rename {name}', { name: t.name })}><Pencil size={13} /></Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-text-secondary" onClick={() => void toggle(t)}>{t.active ? tr('Disable') : tr('Enable')}</Button>
                        <Button size="icon-sm" variant="ghost" className="text-text-tertiary hover:text-critical" onClick={() => setDeleting(t)} aria-label={tr('Delete {name}', { name: t.name })}><Trash2 size={13} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={async () => { await load(); await refresh(); }} />
      <RenameDialog tenant={renaming} onClose={() => setRenaming(null)} onSaved={async () => { await load(); await refresh(); }} />
      <DeleteDialog tenant={deleting} onClose={() => setDeleting(null)} onDeleted={async () => { await load(); await refresh(); toast.success(tr("Company deleted")); }} />
    </div>
  );
}

function CreateTenantDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => Promise<void> }) {
  const empty = { name: '', language: 'es', timezone: 'Europe/Madrid', withAdmin: true, username: '', displayName: '', password: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await adminApi.create({
        name: f.name,
        language: f.language,
        timezone: f.timezone,
        admin: f.withAdmin ? { username: f.username, password: f.password, displayName: f.displayName || undefined } : undefined,
      });
      toast.success(tr('Company {name} created', { name: f.name }));
      setF(empty);
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
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl">{tr("New company")}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">{tr("The admin user can then load the stack, AI key and channels by themselves.")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr("Company name")} htmlFor="nt-name">
            <Input id="nt-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} required maxLength={100} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tr("Digest language")} htmlFor="nt-lang">
              <select id="nt-lang" className={selectCls} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
                <option value="es">{tr("Español")}</option><option value="en">{tr("English")}</option>
              </select>
            </Field>
            <Field label={tr("Time zone")} htmlFor="nt-tz">
              <select id="nt-tz" className={selectCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={f.withAdmin} onChange={(e) => setF({ ...f, withAdmin: e.target.checked })} className="accent-[#E8533F]" />
            <span className="text-text-primary">{tr("Create the company admin now")}</span>
          </label>
          {f.withAdmin && (
            <div className="grid gap-4 sm:grid-cols-2 border border-border-default rounded-lg p-4">
              <Field label={tr("Admin username")} htmlFor="nt-user">
                <Input id="nt-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} className={inputCls} required />
              </Field>
              <Field label={tr("Full name (optional)")} htmlFor="nt-dn">
                <Input id="nt-dn" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} className={inputCls} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={tr("Initial password")} htmlFor="nt-pw" hint={tr("At least 12 characters.")}>
                  <Input id="nt-pw" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className={inputCls} required minLength={12} />
                </Field>
              </div>
            </div>
          )}
          <DialogFooter><Button type="submit" disabled={busy}>{busy ? tr('Creating…') : tr('Create company')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ tenant, onClose, onSaved }: { tenant: TenantSummary | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState('');
  useEffect(() => { if (tenant) setName(tenant.name); }, [tenant]);
  const submit = async () => {
    if (!tenant) return;
    try {
      await adminApi.update(tenant.id, { name });
      onClose();
      await onSaved();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Dialog open={tenant !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
        <DialogHeader><DialogTitle className="font-rajdhani text-xl">{tr("Rename company")}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required maxLength={100} aria-label={tr("Company name")} />
          <DialogFooter><Button type="submit">{tr("Save")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ tenant, onClose, onDeleted }: { tenant: TenantSummary | null; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!tenant) return;
    setBusy(true);
    try {
      await adminApi.remove(tenant.id, confirm);
      setConfirm('');
      onClose();
      await onDeleted();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={tenant !== null} onOpenChange={(o) => { if (!o) { setConfirm(''); onClose(); } }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl text-critical">{tr("Delete")} {tenant?.name}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {tr("Permanently deletes the company with its users, stack, channels and delivery history. This cannot be undone.")}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Field label={tr('Type "{name}" to confirm', { name: tenant?.name ?? '' })} htmlFor="del-confirm">
            <Input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} autoComplete="off" />
          </Field>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy || confirm.trim().toLowerCase() !== tenant?.name.toLowerCase()}>
              {busy ? tr('Deleting…') : tr('Delete company')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

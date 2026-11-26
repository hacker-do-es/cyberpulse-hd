import { useCallback, useEffect, useState } from 'react';
import { Bot, Box, ChevronDown, ChevronRight, Copy, Download, KeyRound, Monitor, Plus, RefreshCw, Terminal, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { inventoryApi, type InventoryAgent, type InventoryToken } from '@/services/hdApi';
import { useAuth, useCan } from '@/lib/auth';
import { timeAgo } from '@/lib/dateUtils';
import { tr, useI18n } from '@/lib/i18n';
import { Badge, EmptyState, Field, PageHeader, Panel } from './ui';
import { inputCls, notifyError, selectCls } from './helpers';

/* Inventory agents: install instructions, the company's agent tokens and
   the hosts that report. Agents keep each asset's technologies and versions
   up to date so vulnerabilities are checked against what really runs. */

const TOKEN_PLACEHOLDER = '<TOKEN>';

function sqlUtc(ts: string | null): Date | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function CodeBlock({ code }: { code: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(tr('Copied'));
    } catch {
      toast.error(tr('Could not copy'));
    }
  };
  return (
    <div className="relative group">
      <pre className="bg-bg-primary border border-border-default rounded-md p-3 pr-10 text-[12px] font-jetbrains text-text-secondary whitespace-pre-wrap break-all">{code}</pre>
      <button
        onClick={() => void copy()}
        className="absolute top-2 right-2 p-1.5 rounded text-text-tertiary hover:text-accent hover:bg-accent/10 cursor-pointer"
        aria-label={tr('Copy')}
      >
        <Copy size={14} />
      </button>
    </div>
  );
}

function linuxInstall(origin: string, token: string): string {
  return [
    `curl -fsSLo cyberpulse-agent.sh ${origin}/api/inventory/agent/linux`,
    `sudo bash cyberpulse-agent.sh install --url ${origin} --token ${token}`,
  ].join('\n');
}

function windowsInstall(origin: string, token: string): string {
  return [
    `Invoke-WebRequest ${origin}/api/inventory/agent/windows -OutFile cyberpulse-agent.ps1`,
    `powershell -ExecutionPolicy Bypass -File .\\cyberpulse-agent.ps1 -Install -Url ${origin} -Token ${token}`,
  ].join('\n');
}

function Instructions({ token }: { token: string }) {
  useI18n();
  const origin = window.location.origin;
  const [os, setOs] = useState<'linux' | 'windows'>('linux');
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['linux', 'windows'] as const).map((o) => (
          <button
            key={o}
            onClick={() => setOs(o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md cursor-pointer ${os === o ? 'text-accent bg-accent-dim' : 'text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated'}`}
          >
            {o === 'linux' ? <Terminal size={14} /> : <Monitor size={14} />}
            {o === 'linux' ? 'Linux' : 'Windows'}
          </button>
        ))}
        <a
          href={`/api/inventory/agent/${os}`}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md text-text-secondary hover:text-accent hover:bg-accent/10"
        >
          <Download size={14} /> {os === 'linux' ? 'cyberpulse-agent.sh' : 'cyberpulse-agent.ps1'}
        </a>
      </div>

      {os === 'linux' ? (
        <div className="space-y-2 text-sm text-text-secondary">
          <p>{tr('Debian, Ubuntu, RHEL/Rocky/Alma, Alpine and derivatives. Needs bash and curl. Run on each server or PC:')}</p>
          <CodeBlock code={linuxInstall(origin, token)} />
          <ul className="list-disc pl-5 text-xs text-text-tertiary space-y-1">
            <li>{tr('Installs a daily systemd timer (or cron) that sends the report; the first report is sent right away.')}</li>
            <li>{tr('Optional: --type server|workstation|laptop (detected from the hardware otherwise).')}</li>
            <li>{tr('With Docker, every running container becomes its own asset (linked to the host) with its image application and the packages inside, read with a read-only "docker exec". Add --no-container-packages to report only the image.')}</li>
            <li>{tr('Review what would be sent, without sending: bash cyberpulse-agent.sh print')}</li>
            <li>{tr('Remove: sudo cyberpulse-agent uninstall')}</li>
          </ul>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-text-secondary">
          <p>{tr('Windows 10/11 and Windows Server. In PowerShell opened as Administrator:')}</p>
          <CodeBlock code={windowsInstall(origin, token)} />
          <ul className="list-disc pl-5 text-xs text-text-tertiary space-y-1">
            <li>{tr('Creates the daily scheduled task "CyberPulse inventory agent" running as SYSTEM; the first report is sent right away.')}</li>
            <li>{tr('Review what would be sent, without sending: .\\cyberpulse-agent.ps1 -Print')}</li>
            <li>{tr('Remove: .\\cyberpulse-agent.ps1 -Uninstall')}</li>
          </ul>
        </div>
      )}

      <div className="rounded-md border border-border-default bg-bg-elevated/40 p-3 text-xs text-text-tertiary space-y-1">
        <p className="text-text-secondary font-medium">{tr('What the agent sends')}</p>
        <p>{tr('Host name, IP addresses, OS and kernel version, hardware brand/model, installed packages or programs with their versions, and running container images. A hash of the machine ID identifies the host. No files, users, passwords or logs. Only outbound HTTPS to this server.')}</p>
        <p>{tr('Only security-relevant software becomes a technology (servers, runtimes, crypto, remote access, browsers, the OS…); the rest is ignored. Debian, Ubuntu and Alpine packages are checked with OSV, which knows the fixes the distribution backports.')}</p>
      </div>
    </div>
  );
}

function AgentRow({ a, nested, extra }: { a: InventoryAgent; nested?: boolean; extra?: ReactNode }) {
  const last = sqlUtc(a.lastReportAt);
  return (
    <tr className={`border-t border-border-default ${nested ? 'bg-bg-elevated/30' : ''}`}>
      <td className={`px-3 py-2 ${nested ? 'pl-9' : ''}`}>
        <div className="text-text-primary font-medium flex items-center gap-1.5">
          {nested && <Box size={13} className="text-text-tertiary" />}
          {a.name}
        </div>
        {!nested && <div className="text-[11px] font-jetbrains text-text-tertiary">{[a.hostname, a.ip].filter(Boolean).join(' · ')}</div>}
        {extra}
      </td>
      <td className="px-3 py-2 text-text-secondary">
        {a.osName ?? '—'}
        {a.osVersion && <span className="block text-[11px] font-jetbrains text-text-tertiary">{a.osVersion}</span>}
      </td>
      <td className="px-3 py-2 text-text-secondary font-jetbrains">{a.technologies}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="text-text-secondary text-xs" title={last?.toLocaleString() ?? ''}>{last ? timeAgo(last) : '—'}</span>
        {a.stale && <span className="ml-2"><Badge tone="warn">{tr('Stale')}</Badge></span>}
      </td>
      <td className="px-3 py-2 text-[11px] font-jetbrains text-text-tertiary">{a.agentVersion ?? '—'}</td>
    </tr>
  );
}

export default function AgentsTab() {
  useI18n();
  const { me } = useAuth();
  const canEdit = useCan()('agents.tokens');
  const [agents, setAgents] = useState<InventoryAgent[]>([]);
  const [staleDays, setStaleDays] = useState(7);
  const [tokens, setTokens] = useState<InventoryToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState<{ name: string; days: number } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<InventoryToken | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const [a, t] = await Promise.all([inventoryApi.agents(), canEdit ? inventoryApi.tokens() : Promise.resolve([])]);
      setAgents(a.agents);
      setStaleDays(a.staleAfterDays);
      setTokens(t);
    } catch (err) {
      notifyError(err, tr('Could not load the agents'));
    } finally {
      setLoading(false);
    }
  }, [canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!newToken?.name.trim() || busy) return;
    setBusy(true);
    try {
      const r = await inventoryApi.createToken(newToken.name.trim(), newToken.days);
      setNewToken(null);
      setCreated(r.token);
      await load();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: InventoryToken) => {
    try {
      await inventoryApi.revokeToken(t.id);
      toast.success(tr('Token revoked'));
      setRevoking(null);
      await load();
    } catch (err) {
      notifyError(err);
    }
  };

  const active = tokens.filter((t) => !t.revokedAt);
  const ids = new Set(agents.map((a) => a.assetId));
  const hosts = agents.filter((a) => !a.parentAssetId || !ids.has(a.parentAssetId));
  const containersOf = new Map<number, InventoryAgent[]>();
  for (const a of agents) {
    if (a.parentAssetId && ids.has(a.parentAssetId)) containersOf.set(a.parentAssetId, [...(containersOf.get(a.parentAssetId) ?? []), a]);
  }

  return (
    <div className="max-w-6xl mx-auto pb-12 space-y-6">
      <PageHeader
        title={`${me?.activeTenant?.name ?? tr('Company')} · ${tr('Agents')}`}
        subtitle={tr('Install the inventory agent on servers and PCs: every day it reports what they run, and each asset keeps its technologies and versions up to date without CSV files.')}
      />

      <Panel
        title={tr('Reporting hosts')}
        icon={<Bot size={18} />}
        description={tr('Assets kept up to date by an agent. A host that has not reported for {n} days is marked as stale.', { n: staleDays })}
        actions={<Button variant="outline" size="sm" className="border-border-default bg-transparent text-text-secondary" onClick={() => void load()}><RefreshCw size={14} /> {tr('Refresh')}</Button>}
      >
        {loading ? (
          <p className="text-sm text-text-tertiary">{tr('Loading…')}</p>
        ) : agents.length === 0 ? (
          <EmptyState>{tr('No host has reported yet. Install the agent with the instructions below.')}</EmptyState>
        ) : (
          <div className="overflow-x-auto border border-border-default rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                  <th className="px-3 py-2 font-medium">{tr('Asset')}</th>
                  <th className="px-3 py-2 font-medium">{tr('Operating system')}</th>
                  <th className="px-3 py-2 font-medium">{tr('Technologies')}</th>
                  <th className="px-3 py-2 font-medium">{tr('Last report')}</th>
                  <th className="px-3 py-2 font-medium">{tr('Agent')}</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((a) => {
                  const kids = containersOf.get(a.assetId) ?? [];
                  const open = expanded.has(a.assetId);
                  return [
                    <AgentRow key={a.assetId} a={a} extra={kids.length > 0 && (
                      <button
                        onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(a.assetId)) n.delete(a.assetId); else n.add(a.assetId); return n; })}
                        className="mt-1 flex items-center gap-1 text-[11px] text-accent hover:underline cursor-pointer"
                      >
                        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {tr('{n} containers', { n: kids.length })}
                      </button>
                    )} />,
                    ...(open ? kids.map((c) => <AgentRow key={c.assetId} a={c} nested />) : []),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {canEdit && (
        <Panel
          title={tr('Agent tokens')}
          icon={<KeyRound size={18} />}
          description={tr('Agents authenticate with a company token that can only send inventory reports. One token per group of hosts makes it easy to revoke.')}
          actions={<Button size="sm" onClick={() => setNewToken({ name: '', days: 0 })}><Plus size={14} /> {tr('New token')}</Button>}
        >
          {tokens.length === 0 ? (
            <EmptyState>{tr('No tokens yet. Create one to install agents.')}</EmptyState>
          ) : (
            <div className="overflow-x-auto border border-border-default rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                    <th className="px-3 py-2 font-medium">{tr('Name')}</th>
                    <th className="px-3 py-2 font-medium">{tr('Token')}</th>
                    <th className="px-3 py-2 font-medium">{tr('Expires')}</th>
                    <th className="px-3 py-2 font-medium">{tr('Last used')}</th>
                    <th className="px-3 py-2 w-16"><span className="sr-only">{tr('Actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const used = sqlUtc(t.lastUsedAt);
                    const exp = sqlUtc(t.expiresAt);
                    return (
                      <tr key={t.id} className={`border-t border-border-default ${t.revokedAt ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2 text-text-primary">{t.name}</td>
                        <td className="px-3 py-2 font-jetbrains text-xs text-text-secondary">{t.prefix}…</td>
                        <td className="px-3 py-2 text-xs text-text-secondary">
                          {t.revokedAt ? <Badge tone="bad">{tr('Revoked')}</Badge> : exp ? exp.toLocaleDateString() : tr('Never')}
                        </td>
                        <td className="px-3 py-2 text-xs text-text-secondary">
                          {used ? <>{timeAgo(used)}{t.lastUsedIp && <span className="block font-jetbrains text-text-tertiary">{t.lastUsedIp}</span>}</> : '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!t.revokedAt && (
                            <button
                              onClick={() => setRevoking(t)}
                              className="p-1.5 rounded text-text-tertiary hover:text-critical hover:bg-critical/10 cursor-pointer"
                              aria-label={tr('Revoke {name}', { name: t.name })}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      <Panel title={tr('Install the agent')} icon={<Terminal size={18} />} description={tr('Replace <TOKEN> with a token from the list above (it is shown only once, when created).')}>
        <Instructions token={TOKEN_PLACEHOLDER} />
        {canEdit && active.length === 0 && <p className="mt-3 text-xs text-medium">{tr('Create a token first.')}</p>}
      </Panel>

      <Dialog open={newToken !== null} onOpenChange={(o) => { if (!o) setNewToken(null); }}>
        <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-rajdhani text-xl">{tr('New agent token')}</DialogTitle>
            <DialogDescription className="text-text-tertiary text-xs">{tr('It can only send inventory reports for this company.')}</DialogDescription>
          </DialogHeader>
          {newToken && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <Field label={tr('Name')} htmlFor="tok-name">
                <Input id="tok-name" value={newToken.name} onChange={(e) => setNewToken({ ...newToken, name: e.target.value })} className={inputCls} maxLength={80} autoFocus placeholder={tr('Production servers')} />
              </Field>
              <Field label={tr('Expires')} htmlFor="tok-exp">
                <select id="tok-exp" className={selectCls} value={newToken.days} onChange={(e) => setNewToken({ ...newToken, days: Number(e.target.value) })}>
                  <option value={0}>{tr('Never')}</option>
                  <option value={90}>{tr('In 90 days')}</option>
                  <option value={365}>{tr('In 1 year')}</option>
                </select>
              </Field>
              <button type="submit" className="hidden" />
            </form>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => setNewToken(null)}>{tr('Cancel')}</Button>
            <Button onClick={() => void create()} disabled={busy || !newToken?.name.trim()}>{busy ? tr('Working…') : tr('Create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={created !== null} onOpenChange={(o) => { if (!o) setCreated(null); }}>
        <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-rajdhani text-xl">{tr('Token created')}</DialogTitle>
            <DialogDescription className="text-medium text-xs">{tr('Copy it now: it will not be shown again. Treat it like a password.')}</DialogDescription>
          </DialogHeader>
          {created && (
            <div className="space-y-4">
              <CodeBlock code={created} />
              <Instructions token={created} />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>{tr('Done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => { if (!o) setRevoking(null); }}>
        <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-rajdhani text-xl">{tr('Revoke token')}</DialogTitle>
            <DialogDescription className="text-text-secondary text-sm">
              {tr('Agents using {name} will stop reporting. Their assets stay as they are.', { name: revoking?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => setRevoking(null)}>{tr('Cancel')}</Button>
            <Button className="bg-critical hover:bg-critical/90" onClick={() => revoking && void revoke(revoking)}>{tr('Revoke')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

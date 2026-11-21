import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, HardDrive, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchTechStack, type AssetCriticality, type AssetRef, type TechStackItem } from '@/services/apiService';
import { ASSET_CRITICALITIES, ASSET_TYPES, assetApi, type Asset, type AssetInput, type AssetType } from '@/services/hdApi';
import { Panel, EmptyState, Field } from './ui';
import { inputCls, selectCls, notifyError } from './helpers';
import { tr } from '@/lib/i18n';
import { assetTypeLabel, criticalityLabel } from './assetLabels';

/* ------------------------------------------------------------------ */
/*  Labels and small shared pieces (also used by the stack, My Stack   */
/*  and channels screens)                                              */
/* ------------------------------------------------------------------ */

const CRIT_CLS: Record<AssetCriticality, string> = {
  high: 'border-critical/50 text-critical bg-critical/10',
  medium: 'border-medium/50 text-medium bg-medium/10',
  low: 'border-border-default text-text-secondary bg-bg-elevated',
};

export function CriticalityBadge({ value }: { value: AssetCriticality }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-jetbrains uppercase tracking-[0.06em] ${CRIT_CLS[value]}`}>
      {criticalityLabel(value)}
    </span>
  );
}

/* Asset names as compact chips, coloured by criticality. */
export function AssetChips({ assets, max = 6 }: { assets: AssetRef[] | undefined; max?: number }) {
  if (!assets?.length) return <span className="text-text-tertiary">—</span>;
  const shown = assets.slice(0, max);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((a) => (
        <span
          key={a.id}
          title={`${criticalityLabel(a.criticality)}${a.environment ? ` · ${a.environment}` : ''}`}
          className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-jetbrains ${CRIT_CLS[a.criticality]}`}
        >
          {a.name}
        </span>
      ))}
      {assets.length > max && <span className="text-[11px] text-text-tertiary">+{assets.length - max}</span>}
    </span>
  );
}

/* Checkbox list in a popover to pick several items by id. */
export function MultiPicker<T extends { id: number }>({ items, selected, onChange, label, render, empty }: {
  items: T[];
  selected: number[];
  onChange: (ids: number[]) => void;
  label: string;
  render: (item: T) => string;
  empty: string;
}) {
  const [q, setQ] = useState('');
  const visible = items.filter((i) => !q || render(i).toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: number) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${selectCls} flex items-center justify-between gap-2 text-left`} aria-label={label}>
          <span className={`truncate ${selected.length ? '' : 'text-text-tertiary'}`}>
            {selected.length ? items.filter((i) => selected.includes(i.id)).map(render).join(', ') : label}
          </span>
          <ChevronDown size={14} className="shrink-0 text-text-tertiary" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2 bg-bg-card border-border-default" align="start">
        {items.length > 8 && (
          <Input placeholder={tr('Search…')} value={q} onChange={(e) => setQ(e.target.value)} className={`${inputCls} h-8 mb-2 text-sm`} />
        )}
        {items.length === 0 ? (
          <p className="text-xs text-text-tertiary p-2">{empty}</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto space-y-0.5">
            {visible.map((i) => (
              <li key={i.id}>
                <label className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-elevated cursor-pointer text-sm text-text-primary">
                  <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} className="accent-[#E8533F]" />
                  <span className="truncate">{render(i)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/*  Assets panel                                                       */
/* ------------------------------------------------------------------ */

const EMPTY: AssetInput = {
  name: '', type: 'server', criticality: 'medium', environment: '', hostname: '', ip: '', brand: '', model: '', owner: '', notes: '', stackItemIds: [],
};

function techLabel(t: TechStackItem): string {
  return t.version ? `${t.technology} ${t.version}` : t.technology;
}

export default function AssetManager({ canEdit, refreshKey, onChanged }: { canEdit: boolean; refreshKey?: number; onChanged?: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [stack, setStack] = useState<TechStackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: number | null; values: AssetInput } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([assetApi.list(), fetchTechStack()]);
      setAssets(a);
      setStack(s);
    } catch (err) {
      notifyError(err, tr('Could not load the assets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const techById = useMemo(() => new Map(stack.map((t) => [t.id, t])), [stack]);

  const save = async () => {
    if (!editing || !editing.values.name.trim() || saving) return;
    setSaving(true);
    try {
      const v = { ...editing.values, name: editing.values.name.trim() };
      if (editing.id === null) await assetApi.create(v);
      else await assetApi.update(editing.id, v);
      toast.success(editing.id === null ? tr('Asset added') : tr('Asset saved'));
      setEditing(null);
      await load();
      onChanged?.();
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (a: Asset) => {
    try {
      await assetApi.remove(a.id);
      setAssets((list) => list.filter((x) => x.id !== a.id));
      setConfirmDelete(null);
      onChanged?.();
    } catch (err) {
      notifyError(err);
    }
  };

  const visible = assets.filter((a) =>
    !filter || [a.name, a.hostname, a.ip, a.brand, a.model, a.environment, a.owner].join(' ').toLowerCase().includes(filter.toLowerCase())
  );

  const set = (patch: Partial<AssetInput>) => setEditing((e) => (e ? { ...e, values: { ...e.values, ...patch } } : e));

  return (
    <Panel
      title={tr('Assets')}
      icon={<HardDrive size={18} />}
      description={tr("The company's servers, devices, apps and services. Link each one to the technologies it runs and news will say which assets it affects.")}
      actions={canEdit && (
        <Button size="sm" onClick={() => setEditing({ id: null, values: { ...EMPTY } })}>
          <Plus size={14} /> {tr('Add asset')}
        </Button>
      )}
    >
      {assets.length > 8 && (
        <Input placeholder={tr('Filter {n} assets…', { n: assets.length })} value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} mb-3 max-w-xs`} />
      )}

      {loading ? (
        <p className="text-sm text-text-tertiary">{tr('Loading…')}</p>
      ) : assets.length === 0 ? (
        <EmptyState>
          {tr('No assets yet.')} {canEdit ? tr('Add them here, or list them in the "assets" column when importing the stack CSV.') : tr('Ask an admin of your company to add them.')}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">{tr('Asset')}</th>
                <th className="px-3 py-2 font-medium">{tr('Criticality')}</th>
                <th className="px-3 py-2 font-medium">{tr('Hostname / IP')}</th>
                <th className="px-3 py-2 font-medium">{tr('Brand / model')}</th>
                <th className="px-3 py-2 font-medium">{tr('Technologies')}</th>
                {canEdit && <th className="px-3 py-2 w-20"><span className="sr-only">{tr('Actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} className="border-t border-border-default hover:bg-bg-elevated/50 align-top">
                  <td className="px-3 py-2">
                    <div className="text-text-primary font-medium">{a.name}</div>
                    <div className="text-[11px] text-text-tertiary">{assetTypeLabel(a.type)}{a.environment ? ` · ${a.environment}` : ''}</div>
                  </td>
                  <td className="px-3 py-2"><CriticalityBadge value={a.criticality} /></td>
                  <td className="px-3 py-2 text-text-secondary font-jetbrains text-xs">
                    <div>{a.hostname ?? '—'}</div>
                    {a.ip && <div className="text-text-tertiary">{a.ip}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {a.stackItemIds.length
                      ? a.stackItemIds.map((id) => techById.get(id)).filter(Boolean).map((t) => techLabel(t!)).join(', ')
                      : <span className="text-text-tertiary">—</span>}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing({
                          id: a.id,
                          values: {
                            name: a.name, type: a.type, criticality: a.criticality, environment: a.environment ?? '', hostname: a.hostname ?? '',
                            ip: a.ip ?? '', brand: a.brand ?? '', model: a.model ?? '', owner: a.owner ?? '', notes: a.notes ?? '', stackItemIds: a.stackItemIds,
                          },
                        })}
                        className="p-1.5 rounded text-text-tertiary hover:text-accent hover:bg-accent/10 cursor-pointer"
                        aria-label={tr('Edit {name}', { name: a.name })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(a)}
                        className="p-1.5 rounded text-text-tertiary hover:text-critical hover:bg-critical/10 cursor-pointer"
                        aria-label={tr('Remove {name}', { name: a.name })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-rajdhani text-xl">{editing?.id === null ? tr('Add asset') : tr('Edit asset')}</DialogTitle>
            <DialogDescription className="text-text-tertiary text-xs">
              {tr('Asset details stay inside CyberPulse. Digests only list affected asset names on channels where you turn it on, and never on LinkedIn.')}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form className="grid grid-cols-1 sm:grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <Field label={tr('Name *')} htmlFor="as-name">
                <Input id="as-name" value={editing.values.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} maxLength={100} autoFocus placeholder="WEB01" />
              </Field>
              <Field label={tr('Type')} htmlFor="as-type">
                <select id="as-type" className={selectCls} value={editing.values.type} onChange={(e) => set({ type: e.target.value as AssetType })}>
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{assetTypeLabel(t)}</option>)}
                </select>
              </Field>
              <Field label={tr('Criticality')} htmlFor="as-crit">
                <select id="as-crit" className={selectCls} value={editing.values.criticality} onChange={(e) => set({ criticality: e.target.value as AssetCriticality })}>
                  {ASSET_CRITICALITIES.map((c) => <option key={c} value={c}>{criticalityLabel(c)}</option>)}
                </select>
              </Field>
              <Field label={tr('Environment')} htmlFor="as-env">
                <Input id="as-env" value={editing.values.environment ?? ''} onChange={(e) => set({ environment: e.target.value })} className={inputCls} maxLength={50} placeholder={tr('prod, dev, test…')} list="as-env-list" />
                <datalist id="as-env-list"><option value="prod" /><option value="dev" /><option value="test" /><option value="staging" /></datalist>
              </Field>
              <Field label={tr('Hostname')} htmlFor="as-host">
                <Input id="as-host" value={editing.values.hostname ?? ''} onChange={(e) => set({ hostname: e.target.value })} className={`${inputCls} font-jetbrains`} maxLength={253} placeholder="web01.example.local" />
              </Field>
              <Field label={tr('IP address')} hint={tr('Several allowed, comma separated.')} htmlFor="as-ip">
                <Input id="as-ip" value={editing.values.ip ?? ''} onChange={(e) => set({ ip: e.target.value })} className={`${inputCls} font-jetbrains`} maxLength={500} placeholder="10.0.0.10" />
              </Field>
              <Field label={tr('Brand')} htmlFor="as-brand">
                <Input id="as-brand" value={editing.values.brand ?? ''} onChange={(e) => set({ brand: e.target.value })} className={inputCls} maxLength={100} placeholder="Dell, Fortinet, Microsoft…" />
              </Field>
              <Field label={tr('Model')} htmlFor="as-model">
                <Input id="as-model" value={editing.values.model ?? ''} onChange={(e) => set({ model: e.target.value })} className={inputCls} maxLength={100} placeholder="PowerEdge R650" />
              </Field>
              <Field label={tr('Owner')} htmlFor="as-owner">
                <Input id="as-owner" value={editing.values.owner ?? ''} onChange={(e) => set({ owner: e.target.value })} className={inputCls} maxLength={100} />
              </Field>
              <Field label={tr('Technologies it runs')}>
                <MultiPicker
                  items={stack}
                  selected={editing.values.stackItemIds ?? []}
                  onChange={(ids) => set({ stackItemIds: ids })}
                  label={tr('Pick from the stack…')}
                  render={techLabel}
                  empty={tr('The stack is empty.')}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label={tr('Notes')} htmlFor="as-notes">
                  <Textarea id="as-notes" value={editing.values.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} className={inputCls} maxLength={1000} rows={2} />
                </Field>
              </div>
              <button type="submit" className="hidden" />
            </form>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => setEditing(null)}>{tr('Cancel')}</Button>
            <Button onClick={() => void save()} disabled={saving || !editing?.values.name.trim()}>{saving ? tr('Working…') : tr('Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-rajdhani text-xl">{tr('Remove asset')}</DialogTitle>
            <DialogDescription className="text-text-secondary text-sm">
              {tr('Remove {name}? It is unlinked from the stack; the technologies stay.', { name: confirmDelete?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => setConfirmDelete(null)}>{tr('Cancel')}</Button>
            <Button className="bg-critical hover:bg-critical/90" onClick={() => confirmDelete && void remove(confirmDelete)}>{tr('Remove')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

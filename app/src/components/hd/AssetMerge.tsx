import { useEffect, useMemo, useState } from 'react';
import { Combine, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { assetApi, MERGE_FIELDS, type Asset, type AssetDuplicate, type AssetMergeValues } from '@/services/hdApi';
import { tr, useI18n } from '@/lib/i18n';
import { Badge } from './ui';
import { inputCls, notifyError, selectCls } from './helpers';
import { assetTypeLabel, criticalityLabel } from './assetLabels';

/* Reconciling duplicates: suggestions, and a dialog that merges several
   assets into one, field by field. */

const FIELD_LABELS: Record<(typeof MERGE_FIELDS)[number], string> = {
  name: 'Name', type: 'Type', criticality: 'Criticality', environment: 'Environment', hostname: 'Hostname',
  ip: 'IP address', brand: 'Brand', model: 'Model', owner: 'Owner', notes: 'Notes',
};

const REASONS: Record<AssetDuplicate['reason'], string> = {
  'same-hostname': 'Same hostname',
  'name-is-hostname': "One's name is the other's hostname",
  'notes-mention-container': 'The notes mention the container',
  'similar-name': 'Similar name',
};

const DISMISSED_KEY = 'cyberpulse.assets.dismissedDuplicates';

function display(field: string, v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return tr('(empty)');
  if (field === 'type') return assetTypeLabel(v as Asset['type']);
  if (field === 'criticality') return criticalityLabel(v as Asset['criticality']);
  return v;
}

export function DuplicateSuggestions({ assets, refreshKey, onReview }: { assets: Asset[]; refreshKey: number; onReview: (ids: number[]) => void }) {
  useI18n();
  const [pairs, setPairs] = useState<AssetDuplicate[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]'); } catch { return []; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    assetApi.duplicates().then(setPairs).catch(() => setPairs([]));
  }, [refreshKey]);

  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const visible = pairs.filter((p) => !dismissed.includes(p.ids.join('-')) && byId.has(p.ids[0]) && byId.has(p.ids[1]));
  if (!visible.length) return null;

  const dismiss = (p: AssetDuplicate) => {
    const next = [...dismissed, p.ids.join('-')];
    setDismissed(next);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  };

  return (
    <div className="mb-4 rounded-lg border border-medium/40 bg-medium/5 p-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-sm text-medium font-medium cursor-pointer">
        <Combine size={15} /> {tr('{n} possible duplicates', { n: visible.length })}
        <span className="text-xs text-text-tertiary font-normal">{open ? tr('hide') : tr('review')}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {visible.map((p) => {
            const [a, b] = p.ids.map((id) => byId.get(id)!);
            return (
              <li key={p.ids.join('-')} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-primary">{a.name}</span>
                <span className="text-text-tertiary">↔</span>
                <span className="text-text-primary">{b.name}</span>
                <span className="text-[11px] text-text-tertiary">· {tr(REASONS[p.reason])}</span>
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 border-border-default bg-transparent text-text-secondary" onClick={() => onReview(p.ids)}>
                    {tr('Review and merge')}
                  </Button>
                  <button onClick={() => dismiss(p)} className="p-1 rounded text-text-tertiary hover:text-text-primary cursor-pointer" aria-label={tr('Not a duplicate')} title={tr('Not a duplicate')}>
                    <X size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function MergeDialog({ assets, ids, onClose, onMerged }: { assets: Asset[]; ids: number[] | null; onClose: () => void; onMerged: () => void }) {
  useI18n();
  const selected = useMemo(() => (ids ?? []).map((id) => assets.find((a) => a.id === id)).filter((a): a is Asset => !!a), [assets, ids]);
  /* Default target: the richest hand-made record (agent assets carry little
     human context; their identity is kept anyway). */
  const [targetId, setTargetId] = useState<number | null>(null);
  const [values, setValues] = useState<AssetMergeValues | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selected.length) return;
    const score = (a: Asset) => (a.agent ? 0 : 100) + [a.owner, a.notes, a.environment, a.hostname, a.ip].filter(Boolean).length;
    setTargetId([...selected].sort((x, y) => score(y) - score(x))[0].id);
  }, [selected]);

  useEffect(() => {
    if (targetId === null || selected.length < 2) return;
    setValues(null);
    assetApi.mergePreview(targetId, selected.filter((a) => a.id !== targetId).map((a) => a.id))
      .then(setValues)
      .catch((err) => { notifyError(err); onClose(); });
  }, [targetId, selected, onClose]);

  const agents = selected.filter((a) => a.agent).length;

  const options = (f: (typeof MERGE_FIELDS)[number]) => {
    const vals = selected.map((a) => (a as unknown as Record<string, string | undefined>)[f] ?? null).filter((v): v is string => !!v);
    return Array.from(new Set(vals));
  };

  const merge = async () => {
    if (targetId === null || !values || busy) return;
    setBusy(true);
    try {
      await assetApi.merge(targetId, selected.filter((a) => a.id !== targetId).map((a) => a.id), values);
      toast.success(tr('Assets merged'));
      onMerged();
      onClose();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={ids !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl">{tr('Merge assets')}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {tr('One record stays with the values you choose and the technologies of all of them; the others are deleted. If one is reported by an agent, the merged asset keeps receiving its reports.')}
          </DialogDescription>
        </DialogHeader>

        {agents > 1 ? (
          <p className="text-sm text-critical">{tr('Two of these assets are reported by inventory agents (different machines or containers): they cannot be merged.')}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1.5">{tr('Record that stays')}</p>
              <div className="space-y-1">
                {selected.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="radio" checked={targetId === a.id} onChange={() => setTargetId(a.id)} />
                    <span className="text-text-primary">{a.name}</span>
                    <span className="text-[11px] text-text-tertiary">{assetTypeLabel(a.type)}</span>
                    {a.agent && <Badge tone="accent">{tr('Agent')}</Badge>}
                  </label>
                ))}
              </div>
            </div>

            {!values ? (
              <p className="text-sm text-text-tertiary">{tr('Loading…')}</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-x-3 gap-y-2 items-center">
                {MERGE_FIELDS.map((f) => {
                  const opts = options(f);
                  const current = values[f] ?? '';
                  return [
                    <span key={`${f}-l`} className="text-xs text-text-secondary">{tr(FIELD_LABELS[f])}</span>,
                    f === 'notes' ? (
                      <Textarea key={f} value={current} onChange={(e) => setValues({ ...values, notes: e.target.value })} className={inputCls} rows={3} maxLength={1000} />
                    ) : opts.length <= 1 && !(f === 'name') ? (
                      <span key={f} className="text-sm text-text-primary">{display(f, current)}</span>
                    ) : (
                      <select key={f} className={selectCls} value={current} onChange={(e) => setValues({ ...values, [f]: e.target.value || null })}>
                        {Array.from(new Set([current, ...opts].filter(Boolean))).map((o) => <option key={o} value={o}>{display(f, o)}</option>)}
                        {f !== 'name' && f !== 'type' && f !== 'criticality' && <option value="">{tr('(empty)')}</option>}
                      </select>
                    ),
                  ];
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={onClose}>{tr('Cancel')}</Button>
          <Button onClick={() => void merge()} disabled={busy || !values || agents > 1}>{busy ? tr('Working…') : tr('Merge {n} assets', { n: selected.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

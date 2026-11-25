import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Download, FileUp, Pencil, Plus, Server, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchTechStack, createTechStackItem, deleteTechStackItem, updateTechStackItem, type TechStackItem } from '@/services/apiService';
import { assetApi, stackApi, type Asset, type ImportSummary } from '@/services/hdApi';
import { AssetChips, MultiPicker } from './AssetManager';
import { Panel, EmptyState, Badge } from './ui';
import { inputCls, notifyError } from './helpers';
import { tr, trMessage } from '@/lib/i18n';

export default function StackManager({ canEdit, refreshKey, onChanged }: { canEdit: boolean; refreshKey?: number; onChanged?: () => void }) {
  const [stack, setStack] = useState<TechStackItem[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ technology: '', version: '', vendor: '', category: '' });
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: number; technology: string; version: string; vendor: string; category: string; cpe: string; assetIds: number[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([fetchTechStack(), assetApi.list().catch(() => [] as Asset[])]);
      setStack(s);
      setAssets(a);
    } catch (err) {
      notifyError(err, tr("Could not load the stack"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const add = async () => {
    if (!form.technology.trim()) return;
    setAdding(true);
    try {
      await createTechStackItem({
        technology: form.technology.trim(),
        version: form.version.trim() || undefined,
        vendor: form.vendor.trim() || undefined,
        category: form.category.trim() || undefined,
      });
      setForm({ technology: '', version: '', vendor: '', category: '' });
      await load();
      onChanged?.();
    } catch (err) {
      notifyError(err);
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (item: TechStackItem) => setEditing({
    id: item.id,
    technology: item.technology,
    version: item.version ?? '',
    vendor: item.vendor ?? '',
    category: item.category ?? '',
    cpe: item.cpe ?? '',
    assetIds: (item.assets ?? []).map((a) => a.id),
  });

  const saveEdit = async () => {
    if (!editing || !editing.technology.trim() || saving) return;
    setSaving(true);
    try {
      const item = await updateTechStackItem(editing.id, {
        technology: editing.technology.trim(),
        version: editing.version.trim(),
        vendor: editing.vendor.trim(),
        category: editing.category.trim(),
        cpe: editing.cpe.trim(),
        assetIds: editing.assetIds,
      });
      setStack((s) => s.map((x) => (x.id === item.id ? item : x)));
      setEditing(null);
      onChanged?.();
    } catch (err) {
      notifyError(err);
    } finally {
      setSaving(false);
    }
  };

  const editKeys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void saveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
  };

  const remove = async (item: TechStackItem) => {
    try {
      await deleteTechStackItem(item.id);
      setStack((s) => s.filter((x) => x.id !== item.id));
      onChanged?.();
    } catch (err) {
      notifyError(err);
    }
  };

  const visible = stack.filter((s) =>
    !filter || `${s.technology} ${s.version ?? ''} ${s.vendor ?? ''} ${s.category ?? ''} ${(s.assets ?? []).map((a) => a.name).join(' ')}`.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Panel
      title={tr("Technology stack")}
      icon={<Server size={18} />}
      description={tr("News is matched against these technologies, both on the My Stack tab and in the channel digests.")}
      actions={
        <>
          <Button asChild variant="outline" size="sm" className="border-border-default bg-transparent text-text-secondary">
            <a href="/api/tech-stack/export.csv"><Download size={14} /> {tr("Export CSV")}</a>
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileUp size={14} /> {tr("Import CSV")}
            </Button>
          )}
        </>
      }
    >
      {canEdit && (
        <form
          className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1.3fr_1.3fr_auto] gap-2 mb-5"
          onSubmit={(e) => { e.preventDefault(); void add(); }}
        >
          <Input placeholder={tr("Technology *")} aria-label={tr("Technology")} value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder={tr("Version")} aria-label={tr("Version")} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder={tr("Vendor")} aria-label={tr("Vendor")} value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder={tr("Category")} aria-label={tr("Category")} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} maxLength={100} />
          <Button type="submit" disabled={adding || !form.technology.trim()}>
            <Plus size={14} /> {tr("Add")}
          </Button>
        </form>
      )}

      {stack.length > 8 && (
        <Input placeholder={tr('Filter {n} technologies…', { n: stack.length })} value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} mb-3 max-w-xs`} />
      )}

      {loading ? (
        <p className="text-sm text-text-tertiary">{tr("Loading…")}</p>
      ) : stack.length === 0 ? (
        <EmptyState>
          {tr("No technologies yet.")} {canEdit ? tr('Add them one by one or import a CSV.') : tr('Ask an admin of your company to add them.')}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">{tr("Technology")}</th>
                <th className="px-3 py-2 font-medium">{tr("Version")}</th>
                <th className="px-3 py-2 font-medium">{tr("Vendor")}</th>
                <th className="px-3 py-2 font-medium">{tr("Category")}</th>
                <th className="px-3 py-2 font-medium">{tr("Assets")}</th>
                {canEdit && <th className="px-3 py-2 w-20"><span className="sr-only">{tr("Actions")}</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => editing?.id === item.id ? (
                <tr key={item.id} className="border-t border-border-default bg-bg-elevated/50">
                  {(['technology', 'version', 'vendor', 'category'] as const).map((field) => (
                    <td key={field} className="px-2 py-1.5">
                      <Input
                        value={editing[field]}
                        onChange={(e) => setEditing({ ...editing, [field]: e.target.value })}
                        onKeyDown={editKeys}
                        aria-label={field[0].toUpperCase() + field.slice(1)}
                        placeholder={field === 'technology' ? tr('Technology *') : ''}
                        className={`${inputCls} h-8 text-sm`}
                        maxLength={100}
                        autoFocus={field === 'technology'}
                      />
                      {field === 'technology' && (
                        <Input
                          value={editing.cpe}
                          onChange={(e) => setEditing({ ...editing, cpe: e.target.value })}
                          onKeyDown={editKeys}
                          aria-label="CPE"
                          title={tr('Optional: vendor:product as CVE records name it (e.g. f5:nginx_open_source), when the name alone does not identify the product.')}
                          placeholder={tr('CPE vendor:product (optional)')}
                          className={`${inputCls} h-7 text-xs font-jetbrains mt-1`}
                          maxLength={200}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 min-w-40">
                    <MultiPicker
                      items={assets}
                      selected={editing.assetIds}
                      onChange={(ids) => setEditing({ ...editing, assetIds: ids })}
                      label={tr('Assets…')}
                      render={(a) => a.name}
                      empty={tr('No assets yet: add them in the Assets tab.')}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => void saveEdit()}
                      disabled={saving || !editing.technology.trim()}
                      className="p-1.5 rounded text-text-tertiary hover:text-accent hover:bg-accent/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={tr("Save changes")}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="p-1.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated cursor-pointer"
                      aria-label={tr("Cancel editing")}
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={item.id} className="border-t border-border-default hover:bg-bg-elevated/50">
                  <td className="px-3 py-2 text-text-primary font-medium">
                    {item.technology}
                    {item.cpe && <div className="text-[10px] font-jetbrains text-text-tertiary" title="CPE">{item.cpe}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-secondary font-jetbrains text-xs">{item.version ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{item.vendor ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{item.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    <AssetChips assets={item.assets?.map((a) => (a.version ? { ...a, name: `${a.name} · ${a.version}` } : a))} />
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEdit(item)}
                        className="p-1.5 rounded text-text-tertiary hover:text-accent hover:bg-accent/10 cursor-pointer"
                        aria-label={tr('Edit {name}', { name: item.technology })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => void remove(item)}
                        className="p-1.5 rounded text-text-tertiary hover:text-critical hover:bg-critical/10 cursor-pointer"
                        aria-label={tr('Remove {name}', { name: item.technology })}
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

      {canEdit && (
        <CsvImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImported={async () => { await load(); onChanged?.(); }}
        />
      )}
    </Panel>
  );
}

function CsvImportDialog({ open, onOpenChange, onImported }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onImported: () => Promise<void>;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsv(null);
    setFileName('');
    setPreview(null);
    setMode('append');
    if (fileRef.current) fileRef.current.value = '';
  };

  const runPreview = useCallback(async (text: string, m: 'append' | 'replace') => {
    setBusy(true);
    try {
      setPreview(await stackApi.importCsv(text, m, true));
    } catch (err) {
      notifyError(err);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error(tr("The file is larger than 1 MB"));
      return;
    }
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
    await runPreview(text, mode);
  };

  const confirm = async () => {
    if (!csv) return;
    setBusy(true);
    try {
      const r = await stackApi.importCsv(csv, mode, false);
      toast.success(r.imported === 1 ? tr('Imported 1 technology') : tr('Imported {n} technologies', { n: r.imported ?? 0 }));
      await onImported();
      reset();
      onOpenChange(false);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl">{tr("Import stack from CSV")}</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            {tr("Columns:")} <code className="font-jetbrains text-text-secondary">{tr("technology, version, vendor, category, assets")}</code>{tr(". Only technology is required. Comma or semicolon separated, English or Spanish headers, Excel exports work as-is.")}{' '}{tr('In "assets", separate several asset names with |; new names are created as assets.')}{' '}
            <a href="/api/tech-stack/template.csv" className="text-accent hover:underline">{tr("Download template")}</a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label
            className="flex flex-col items-center justify-center gap-2 border border-dashed border-border-default rounded-lg py-8 cursor-pointer hover:border-accent/60 hover:bg-accent/5 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}
          >
            <Upload size={22} className="text-accent" />
            <span className="text-sm text-text-secondary">{fileName || tr('Choose a .csv file or drop it here')}</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">{tr("Import mode")}</legend>
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === m}
                  onChange={() => { setMode(m); if (csv) void runPreview(csv, m); }}
                  className="accent-[#E8533F]"
                />
                <span className="text-text-primary">{m === 'append' ? tr('Add to current stack') : tr('Replace current stack')}</span>
              </label>
            ))}
          </fieldset>

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="ok">{preview.toInsert} {tr("to add")}</Badge>
                {preview.alreadyPresent > 0 && <Badge>{preview.alreadyPresent} {tr("already in stack")}</Badge>}
                {preview.duplicatesInFile > 0 && <Badge>{preview.duplicatesInFile} {tr("duplicated in file")}</Badge>}
                {preview.errorCount > 0 && <Badge tone="bad">{preview.errorCount} {tr("invalid rows")}</Badge>}
                {(preview.assetsToCreateCount ?? 0) > 0 && <Badge tone="accent">{preview.assetsToCreateCount} {tr("new assets")}</Badge>}
                {(preview.assetLinksToExisting ?? 0) > 0 && <Badge>{preview.assetLinksToExisting} {tr("existing rows get assets")}</Badge>}
                {preview.mode === 'replace' && preview.willRemove > 0 && <Badge tone="warn">{preview.willRemove} {tr("current entries will be removed")}</Badge>}
              </div>

              {preview.errors.length > 0 && (
                <ul className="text-xs text-critical space-y-0.5 max-h-24 overflow-y-auto">
                  {preview.errors.map((e, i) => (
                    <li key={i}>{e.line > 0 ? tr('Line {n}: ', { n: e.line }) : ''}{trMessage(e.message)}</li>
                  ))}
                </ul>
              )}

              {(preview.preview?.length ?? 0) > 0 && (
                <div className="border border-border-default rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-bg-elevated">
                      <tr className="text-left text-text-tertiary font-jetbrains uppercase text-[10px]">
                        <th className="px-3 py-1.5">{tr("Technology")}</th><th className="px-3 py-1.5">{tr("Version")}</th>
                        <th className="px-3 py-1.5">{tr("Vendor")}</th><th className="px-3 py-1.5">{tr("Category")}</th><th className="px-3 py-1.5">{tr("Assets")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview!.map((r, i) => (
                        <tr key={i} className="border-t border-border-default">
                          <td className="px-3 py-1.5 text-text-primary">{r.technology}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.version ?? ''}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.vendor ?? ''}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.category ?? ''}</td>
                          <td className="px-3 py-1.5 text-text-secondary font-jetbrains">{(r.assets ?? []).join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="border-border-default bg-transparent text-text-secondary" onClick={() => onOpenChange(false)}>
            {tr("Cancel")}
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || !preview || preview.valid === 0 || (preview.mode === 'append' && preview.toInsert === 0 && !preview.assetLinksToExisting)}
          >
            {busy ? tr('Working…') : mode === 'replace' ? tr('Replace stack') : tr('Import {n}', { n: preview?.toInsert ?? '' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

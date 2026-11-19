import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileUp, Plus, Server, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchTechStack, createTechStackItem, deleteTechStackItem, type TechStackItem } from '@/services/apiService';
import { stackApi, type ImportSummary } from '@/services/hdApi';
import { Panel, EmptyState, Badge } from './ui';
import { inputCls, notifyError } from './helpers';

export default function StackManager({ canEdit, onChanged }: { canEdit: boolean; onChanged?: () => void }) {
  const [stack, setStack] = useState<TechStackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ technology: '', version: '', vendor: '', category: '' });
  const [adding, setAdding] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStack(await fetchTechStack());
    } catch (err) {
      notifyError(err, 'Could not load the stack');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    !filter || `${s.technology} ${s.version ?? ''} ${s.vendor ?? ''} ${s.category ?? ''}`.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Panel
      title="Technology stack"
      icon={<Server size={18} />}
      description="News is matched against these technologies, both on the My Stack tab and in the channel digests."
      actions={
        <>
          <Button asChild variant="outline" size="sm" className="border-border-default bg-transparent text-text-secondary">
            <a href="/api/tech-stack/export.csv"><Download size={14} /> Export CSV</a>
          </Button>
          {canEdit && (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <FileUp size={14} /> Import CSV
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
          <Input placeholder="Technology *" aria-label="Technology" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder="Version" aria-label="Version" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder="Vendor" aria-label="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className={inputCls} maxLength={100} />
          <Input placeholder="Category" aria-label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={inputCls} maxLength={100} />
          <Button type="submit" disabled={adding || !form.technology.trim()}>
            <Plus size={14} /> Add
          </Button>
        </form>
      )}

      {stack.length > 8 && (
        <Input placeholder={`Filter ${stack.length} technologies…`} value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} mb-3 max-w-xs`} />
      )}

      {loading ? (
        <p className="text-sm text-text-tertiary">Loading…</p>
      ) : stack.length === 0 ? (
        <EmptyState>
          No technologies yet. {canEdit ? 'Add them one by one or import a CSV.' : 'Ask an admin of your company to add them.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-jetbrains uppercase tracking-[0.08em] text-text-tertiary bg-bg-elevated">
                <th className="px-3 py-2 font-medium">Technology</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Category</th>
                {canEdit && <th className="px-3 py-2 w-10"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="border-t border-border-default hover:bg-bg-elevated/50">
                  <td className="px-3 py-2 text-text-primary font-medium">{item.technology}</td>
                  <td className="px-3 py-2 text-text-secondary font-jetbrains text-xs">{item.version ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{item.vendor ?? '—'}</td>
                  <td className="px-3 py-2 text-text-secondary">{item.category ?? '—'}</td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void remove(item)}
                        className="p-1.5 rounded text-text-tertiary hover:text-critical hover:bg-critical/10 cursor-pointer"
                        aria-label={`Remove ${item.technology}`}
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
      toast.error('The file is larger than 1 MB');
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
      toast.success(`Imported ${r.imported} ${r.imported === 1 ? 'technology' : 'technologies'}`);
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
          <DialogTitle className="font-rajdhani text-xl">Import stack from CSV</DialogTitle>
          <DialogDescription className="text-text-tertiary text-xs">
            Columns: <code className="font-jetbrains text-text-secondary">technology, version, vendor, category</code>. Only technology is
            required. Comma or semicolon separated, English or Spanish headers, Excel exports work as-is.{' '}
            <a href="/api/tech-stack/template.csv" className="text-accent hover:underline">Download template</a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label
            className="flex flex-col items-center justify-center gap-2 border border-dashed border-border-default rounded-lg py-8 cursor-pointer hover:border-accent/60 hover:bg-accent/5 transition-colors"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void onFile(e.dataTransfer.files?.[0]); }}
          >
            <Upload size={22} className="text-accent" />
            <span className="text-sm text-text-secondary">{fileName || 'Choose a .csv file or drop it here'}</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>

          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">Import mode</legend>
            {(['append', 'replace'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === m}
                  onChange={() => { setMode(m); if (csv) void runPreview(csv, m); }}
                  className="accent-[#E8533F]"
                />
                <span className="text-text-primary">{m === 'append' ? 'Add to current stack' : 'Replace current stack'}</span>
              </label>
            ))}
          </fieldset>

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="ok">{preview.toInsert} to add</Badge>
                {preview.alreadyPresent > 0 && <Badge>{preview.alreadyPresent} already in stack</Badge>}
                {preview.duplicatesInFile > 0 && <Badge>{preview.duplicatesInFile} duplicated in file</Badge>}
                {preview.errorCount > 0 && <Badge tone="bad">{preview.errorCount} invalid rows</Badge>}
                {preview.mode === 'replace' && preview.willRemove > 0 && <Badge tone="warn">{preview.willRemove} current entries will be removed</Badge>}
              </div>

              {preview.errors.length > 0 && (
                <ul className="text-xs text-critical space-y-0.5 max-h-24 overflow-y-auto">
                  {preview.errors.map((e, i) => (
                    <li key={i}>{e.line > 0 ? `Line ${e.line}: ` : ''}{e.message}</li>
                  ))}
                </ul>
              )}

              {(preview.preview?.length ?? 0) > 0 && (
                <div className="border border-border-default rounded-lg max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-bg-elevated">
                      <tr className="text-left text-text-tertiary font-jetbrains uppercase text-[10px]">
                        <th className="px-3 py-1.5">Technology</th><th className="px-3 py-1.5">Version</th>
                        <th className="px-3 py-1.5">Vendor</th><th className="px-3 py-1.5">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview!.map((r, i) => (
                        <tr key={i} className="border-t border-border-default">
                          <td className="px-3 py-1.5 text-text-primary">{r.technology}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.version ?? ''}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.vendor ?? ''}</td>
                          <td className="px-3 py-1.5 text-text-secondary">{r.category ?? ''}</td>
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
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={busy || !preview || preview.valid === 0 || (preview.mode === 'append' && preview.toInsert === 0)}
          >
            {busy ? 'Working…' : mode === 'replace' ? 'Replace stack' : `Import ${preview?.toInsert ?? ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

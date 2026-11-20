import { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { authApi } from '@/services/hdApi';
import { useAuth } from '@/lib/auth';
import { Field } from './ui';
import { inputCls, notifyError } from './helpers';
import { tr } from '@/lib/i18n';

export default function AccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me, refresh } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePw, setDisablePw] = useState('');
  const [busy, setBusy] = useState(false);

  const close = (o: boolean) => {
    if (!o) {
      setPw({ current: '', next: '', repeat: '' });
      setEnrol(null);
      setCode('');
      setDisablePw('');
    }
    onOpenChange(o);
  };

  const changePassword = async () => {
    if (pw.next !== pw.repeat) {
      toast.error(tr("The new passwords do not match"));
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', repeat: '' });
      toast.success(tr("Password changed. Other sessions were closed."));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const startTotp = async () => {
    try {
      const r = await authApi.totpSetup();
      setEnrol({ secret: r.secret, qr: r.qr });
    } catch (err) {
      notifyError(err);
    }
  };

  const confirmTotp = async () => {
    try {
      await authApi.totpEnable(code.trim());
      setEnrol(null);
      setCode('');
      await refresh();
      toast.success(tr("Two-factor authentication enabled"));
    } catch (err) {
      notifyError(err);
    }
  };

  const disableTotp = async () => {
    try {
      await authApi.totpDisable(disablePw);
      setDisablePw('');
      await refresh();
      toast.success(tr("Two-factor authentication disabled"));
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="bg-bg-card border-border-default text-text-primary sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-rajdhani text-xl">{tr("My account ·")} {me?.user.username}</DialogTitle>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><KeyRound size={15} className="text-accent" /> {tr("Change password")}</h3>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void changePassword(); }}>
            <input type="text" autoComplete="username" value={me?.user.username ?? ''} readOnly hidden />
            <Field label={tr("Current password")} htmlFor="ac-cur">
              <Input id="ac-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={inputCls} required />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tr("New password")} htmlFor="ac-new" hint={tr("At least 12 characters.")}>
                <Input id="ac-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} className={inputCls} required minLength={12} />
              </Field>
              <Field label={tr("Repeat")} htmlFor="ac-rep">
                <Input id="ac-rep" type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} className={inputCls} required minLength={12} />
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={busy}>{tr("Change password")}</Button>
          </form>
        </section>

        <hr className="border-border-default my-2" />

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><ShieldCheck size={15} className="text-accent" /> {tr("Two-factor authentication")}</h3>
          {me?.user.totpEnabled ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void disableTotp(); }}>
              <p className="text-xs text-low">{tr("Enabled. You are asked for a code from your authenticator app at every login.")}</p>
              <Field label={tr("Password to disable it")} htmlFor="ac-dis">
                <Input id="ac-dis" type="password" autoComplete="current-password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} className={inputCls} required />
              </Field>
              <Button type="submit" size="sm" variant="outline" className="border-border-default bg-transparent text-text-secondary">{tr("Disable 2FA")}</Button>
            </form>
          ) : enrol ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void confirmTotp(); }}>
              <p className="text-xs text-text-secondary">{tr("Scan with Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…, then type the 6-digit code.")}</p>
              <div className="flex flex-wrap items-center gap-4">
                <img src={enrol.qr} alt={tr("TOTP QR code")} width={160} height={160} className="rounded bg-white p-1" />
                <div className="text-[11px] text-text-tertiary break-all max-w-[220px]">
                  {tr("Manual key:")}<br /><span className="font-jetbrains text-text-secondary">{enrol.secret}</span>
                </div>
              </div>
              <Field label={tr("Code")} htmlFor="ac-code">
                <Input id="ac-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={`${inputCls} font-jetbrains tracking-[0.3em] w-40`} required />
              </Field>
              <Button type="submit" size="sm">{tr("Enable 2FA")}</Button>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-text-tertiary">{tr("Recommended for every admin account.")}</p>
              <Button size="sm" onClick={() => void startTotp()}>{tr("Set up 2FA")}</Button>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

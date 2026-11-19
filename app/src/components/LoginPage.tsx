import { useState, type FormEvent } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authApi, ApiError } from '@/services/hdApi';

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.login(username.trim(), password, needTotp ? totp.trim() : undefined);
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError && err.data?.totpRequired) {
        if (needTotp) setError(err.message);
        setNeedTotp(true);
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-bg-primary flex items-center justify-center px-4 relative overflow-hidden">
      {/* Brand backdrop: faint hex grid glow in the accent colour. */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(600px circle at 20% 10%, rgba(232, 83, 63, 0.10), transparent 60%), radial-gradient(500px circle at 85% 90%, rgba(232, 83, 63, 0.06), transparent 60%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/hackerdo-logo.png" alt="Hacker-Do" width="202" height="72" className="h-[72px] w-auto" />
          <span className="mt-3 font-orbitron text-lg font-bold tracking-[0.22em] text-text-primary">
            CYBER<span className="text-accent">PULSE</span>
          </span>
          <span className="mt-1 text-[11px] font-jetbrains uppercase tracking-[0.12em] text-text-tertiary">
            Threat intel for your stack
          </span>
        </div>

        <form
          onSubmit={submit}
          className="bg-bg-card border border-border-default rounded-xl p-6 shadow-[0_0_0_1px_rgba(232,83,63,0.04),0_20px_60px_-20px_rgba(0,0,0,0.6)]"
        >
          <h1 className="font-rajdhani text-xl font-semibold text-text-primary mb-5 flex items-center gap-2">
            <Lock size={18} className="text-accent" /> Sign in
          </h1>

          {!needTotp ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-text-secondary text-xs">Username</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-bg-input border-border-default text-text-primary"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-text-secondary text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-bg-input border-border-default text-text-primary"
                  required
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="totp" className="text-text-secondary text-xs flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-accent" /> Code from your authenticator app
              </Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                pattern="\d{6}"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                className="bg-bg-input border-border-default text-text-primary font-jetbrains tracking-[0.4em] text-center text-lg"
                required
              />
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-critical">{error}</p>
          )}

          <Button type="submit" disabled={busy} className="w-full mt-6 h-10 font-semibold">
            {busy ? 'Checking…' : needTotp ? 'Verify' : 'Sign in'}
          </Button>
          {needTotp && (
            <button
              type="button"
              onClick={() => { setNeedTotp(false); setTotp(''); setError(null); }}
              className="w-full mt-3 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer"
            >
              Back
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-[11px] text-text-tertiary">
          © Hacker-Do · <a className="hover:text-accent" href="https://hacker-do.es" target="_blank" rel="noreferrer">hacker-do.es</a>
        </p>
      </div>
    </div>
  );
}

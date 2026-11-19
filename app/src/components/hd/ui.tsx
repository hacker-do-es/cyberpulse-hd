import type { ReactNode } from 'react';

/* Small shared building blocks for the Hacker-Do management screens. */

export function Panel({ title, description, icon, actions, children }: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-bg-card border border-border-default rounded-xl">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-border-default">
        <div className="min-w-0">
          <h2 className="font-rajdhani text-lg font-semibold text-text-primary flex items-center gap-2">
            {icon && <span className="text-accent">{icon}</span>}
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-text-tertiary max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="font-rajdhani text-2xl font-bold text-text-primary tracking-wide">{title}</h1>
      {subtitle && <p className="text-sm text-text-tertiary mt-1">{subtitle}</p>}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-text-secondary">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-text-tertiary">{hint}</p>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  const tones: Record<string, string> = {
    neutral: 'bg-bg-elevated text-text-secondary border-border-default',
    accent: 'bg-accent/10 text-accent border-accent/30',
    ok: 'bg-low/10 text-low border-low/30',
    warn: 'bg-medium/10 text-medium border-medium/30',
    bad: 'bg-critical/10 text-critical border-critical/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-jetbrains uppercase tracking-[0.06em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="text-sm text-text-tertiary border border-dashed border-border-default rounded-lg px-4 py-8 text-center">
      {children}
    </div>
  );
}


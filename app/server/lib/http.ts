import type express from 'express';

/* An error that maps straight to an HTTP response. Services and use cases
   throw it; the error middleware turns it into `{ error, ...extra }`. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, extra?: Record<string, unknown>) => new HttpError(400, msg, extra);
export const forbidden = (msg: string) => new HttpError(403, msg);
export const notFound = (msg: string) => new HttpError(404, msg);
export const conflict = (msg: string, extra?: Record<string, unknown>) => new HttpError(409, msg, extra);

type Handler = (req: express.Request, res: express.Response) => unknown;

/* Express 5 already forwards rejected promises to the error middleware; this
   wrapper keeps synchronous throws and async rejections on the same path. */
export function handle(fn: Handler): express.RequestHandler {
  return (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out instanceof Promise) out.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Input helpers                                                      */
/* ------------------------------------------------------------------ */

/* Required text: trimmed, non-empty, at most `max` characters. */
export function str(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 || t.length > max ? null : t;
}

/* Optional text: trimmed and clipped; empty becomes null. */
export function optStr(v: unknown, max = 200): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export function idParam(req: express.Request): number {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

export function mask(secret: string): string {
  if (!secret) return '';
  return secret.length <= 8 ? '••••' : `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

/* The tenant every tenant-scoped endpoint acts on (set by requireTenant). */
export function tenantOf(req: express.Request): number {
  return req.auth!.tenantId as number;
}

export function isUniqueViolation(err: unknown): boolean {
  return String((err as Error)?.message ?? '').includes('UNIQUE constraint failed');
}

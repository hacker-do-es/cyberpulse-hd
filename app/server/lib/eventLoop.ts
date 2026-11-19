import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';
import { setImmediate as yieldNow } from 'timers/promises';

/* Node runs all JavaScript on one thread. `await` on I/O does not block it
   (the thread is free while the request waits); what blocks it is long
   synchronous CPU work. CPU-heavy loops over many items go through
   `forEachChunked`, which hands control back to the event loop between
   chunks so other requests keep being served. */

export async function forEachChunked<T>(
  items: readonly T[],
  fn: (item: T, index: number) => void,
  { chunkSize = 100 }: { chunkSize?: number } = {},
): Promise<void> {
  for (let start = 0; start < items.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, items.length);
    for (let i = start; i < end; i++) fn(items[i], i);
    if (end < items.length) await yieldNow();
  }
}

/* ------------------------------------------------------------------ */
/*  Event loop delay, exposed on /api/health                           */
/* ------------------------------------------------------------------ */

let histogram: IntervalHistogram | null = null;

export function startEventLoopMonitor(): void {
  if (histogram) return;
  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
}

export interface EventLoopStats {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

/* Delay figures since the previous call (the histogram is reset each time). */
export function eventLoopStats(): EventLoopStats | null {
  if (!histogram || histogram.count === 0) return null;
  const ms = (ns: number) => Math.round((ns / 1e6) * 10) / 10;
  const stats = { p50Ms: ms(histogram.percentile(50)), p99Ms: ms(histogram.percentile(99)), maxMs: ms(histogram.max) };
  histogram.reset();
  return stats;
}

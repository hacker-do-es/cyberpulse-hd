import os from 'os';
import { Worker } from 'worker_threads';

/* Fetches and parses feeds on a small pool of worker threads (see
   feedWorker.mjs), so XML parsing never blocks the event loop. Each worker
   handles many feeds at once (the download is async); only the parsing is
   serial within a worker. */

export interface FeedItem {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
}

type Reply = { id: number; items?: FeedItem[]; error?: string };

interface Pending {
  resolve: (items: FeedItem[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/* Download timeout is 15 s inside the worker; this is the outer safety net. */
const REQUEST_TIMEOUT_MS = 45_000;
const POOL_SIZE = Math.max(1, Math.min(2, os.availableParallelism() - 1));
const WORKER_URL = new URL('./feedWorker.mjs', import.meta.url);

class FeedWorker {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  get load(): number {
    return this.pending.size;
  }

  private start(): Worker {
    const worker = new Worker(WORKER_URL);
    /* Idle workers must not keep the process alive (CLI, tests). */
    worker.unref();
    worker.on('message', (msg: Reply) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.items ?? []);
    });
    /* A crashed worker fails its in-flight feeds; the next request starts a
       fresh one. */
    const fail = (err: Error) => {
      if (this.worker === worker) this.worker = null;
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(err);
        this.pending.delete(id);
      }
    };
    worker.on('error', fail);
    worker.on('exit', (code) => { if (code !== 0) fail(new Error(`Feed worker exited with code ${code}`)); else if (this.worker === worker) this.worker = null; });
    return worker;
  }

  fetch(url: string): Promise<FeedItem[]> {
    this.worker ??= this.start();
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Feed timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, url });
    });
  }

  async close(): Promise<void> {
    const w = this.worker;
    this.worker = null;
    if (w) await w.terminate();
  }
}

const pool = Array.from({ length: POOL_SIZE }, () => new FeedWorker());

/* Downloads and parses one feed; resolves with its newest items. */
export function fetchFeed(url: string): Promise<FeedItem[]> {
  const least = pool.reduce((a, b) => (b.load < a.load ? b : a));
  return least.fetch(url);
}

export async function closeFeedWorkers(): Promise<void> {
  await Promise.all(pool.map((w) => w.close()));
}

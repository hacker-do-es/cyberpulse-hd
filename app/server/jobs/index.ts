import cron from 'node-cron';
import { config, DEFAULT_SCRAPE_CRON } from '../config';
import { channelRepository, deliveryRepository } from '../repositories/channelRepository';
import { rescheduleChannel } from '../services/channelSchedule';
import { toSqlUtc } from '../services/schedule';
import { cleanOldArticles, scrapeAll } from '../services/scraper';
import { runChannelDigest } from '../useCases/runChannelDigest';
import { publishDuePosts } from '../services/linkedin/queueWorker';
import { runCveJob } from '../services/vuln/cveSync';
import { cveRepository } from '../repositories/cveRepository';
import { runOsvJob } from '../services/vuln/osv';

/* ------------------------------------------------------------------ */
/*  Scrape                                                             */
/* ------------------------------------------------------------------ */

export const scrapeState = {
  running: false,
  startedAt: null as string | null,
  lastResult: { totalNew: 0, errors: [] as string[], finishedAt: null as string | null },
};

export async function runScrape(): Promise<void> {
  if (scrapeState.running) {
    console.log('[SCRAPER] Scrape already in progress, skipping');
    return;
  }
  scrapeState.running = true;
  scrapeState.startedAt = new Date().toISOString();
  try {
    const result = await scrapeAll();
    scrapeState.lastResult = { totalNew: result.total, errors: result.errors, finishedAt: new Date().toISOString() };
  } catch (err: any) {
    console.error('[SCRAPER] Background scrape failed:', err);
    scrapeState.lastResult = { totalNew: 0, errors: [err?.message || 'Unknown error'], finishedAt: new Date().toISOString() };
  } finally {
    scrapeState.running = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Channel digests                                                    */
/* ------------------------------------------------------------------ */

let tickRunning = false;

/* Called every minute. next_run_at is advanced before sending, so a crash or
   a slow webhook can never make the same slot fire twice. Due channels are
   independent, so they are sent concurrently (a few at a time) instead of
   one slow webhook holding up every other company. */
const DIGEST_CONCURRENCY = 4;

export async function schedulerTick(now = new Date()): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const due = channelRepository.dueIds(toSqlUtc(now));
    for (const id of due) rescheduleChannel(id, now);

    let cursor = 0;
    const worker = async () => {
      while (cursor < due.length) {
        const id = due[cursor++];
        try {
          const result = await runChannelDigest(id, 'schedule');
          console.log(`[SCHEDULER] channel ${id}: ${result.status} (${result.detail})`);
        } catch (err) {
          console.error(`[SCHEDULER] channel ${id} failed:`, err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(DIGEST_CONCURRENCY, due.length) }, worker));
  } finally {
    tickRunning = false;
  }
}

/* ------------------------------------------------------------------ */
/*  Startup                                                            */
/* ------------------------------------------------------------------ */

export function startJobs(): void {
  /* The first scrape runs in the background so the server (and its Docker
     healthcheck) is up while feeds are still being fetched. */
  console.log('[SERVER] Running initial RSS scrape in background...');
  runScrape().then(cleanOldArticles).catch((err) => console.error('[SCRAPER] Initial scrape failed:', err));

  let scrapeCron = config.scrapeCron;
  if (!cron.validate(scrapeCron)) {
    console.warn(`[CRON] Invalid SCRAPE_CRON "${scrapeCron}", falling back to "${DEFAULT_SCRAPE_CRON}"`);
    scrapeCron = DEFAULT_SCRAPE_CRON;
  }
  console.log(`[CRON] Scrape schedule: ${scrapeCron}`);
  cron.schedule(scrapeCron, () => runScrape().then(cleanOldArticles));

  cron.schedule('0 2 * * *', () => {
    cleanOldArticles();
    deliveryRepository.prune();
    /* CVE data nobody looked at in 90 days is re-fetched if ever needed. */
    cveRepository.pruneOlderThan(toSqlUtc(new Date(Date.now() - 90 * 86400_000)));
  });

  /* CVE affected-version data for the news of the last 30 days, so version
     verdicts are ready before digests run. First pass shortly after start
     (after the initial scrape has had time to add articles). */
  const cveJob = () => runCveJob().catch((err) => console.error('[CVE] sync failed:', err));
  setTimeout(cveJob, 90_000).unref();
  cron.schedule('*/20 * * * *', cveJob);

  /* Agent-reported distro packages: re-check against OSV once a day (new
     CVEs, tracker updates); reports trigger their own check. */
  cron.schedule('15 4 * * *', () => void runOsvJob());

  cron.schedule('* * * * *', () => {
    schedulerTick().catch((err) => console.error('[SCHEDULER] tick failed:', err));
    publishDuePosts().catch((err) => console.error('[LINKEDIN] queue tick failed:', err));
  });
}

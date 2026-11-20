import { linkedinQueueRepository } from '../../repositories/linkedinQueueRepository';
import { toSqlUtc } from '../schedule';
import { PublishError, publishAs } from './accounts';

/* Publishes queued LinkedIn posts whose time has come (approved channel
   posts and posts scheduled by hand). Each row is claimed atomically
   (scheduled → publishing) so two workers never post it twice. */

let busy = false;

export async function publishDuePosts(now = new Date()): Promise<number> {
  if (busy) return 0;
  busy = true;
  let done = 0;
  try {
    const nowSql = toSqlUtc(now);
    linkedinQueueRepository.recoverStuck(toSqlUtc(new Date(now.getTime() - 15 * 60_000)));
    for (const row of linkedinQueueRepository.due(nowSql)) {
      if (!linkedinQueueRepository.transition(row.id, ['scheduled'], { status: 'publishing', decidedAt: row.decidedAt ?? nowSql })) continue;
      try {
        const r = await publishAs(row.authorUserId, row.tenantId, row.author, row.text);
        linkedinQueueRepository.update(row.id, { status: 'published', postUrn: r.urn, publishedAt: toSqlUtc(new Date()), error: null });
        done++;
      } catch (err) {
        const msg = err instanceof PublishError ? err.message : 'LinkedIn request failed';
        linkedinQueueRepository.update(row.id, { status: 'failed', error: msg.slice(0, 500) });
        console.warn(`[LINKEDIN] queued post ${row.id} failed: ${msg}`);
      }
    }
  } finally {
    busy = false;
  }
  return done;
}

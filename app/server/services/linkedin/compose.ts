import { generateDailyDigestPost, generateMockPost, type Format, type Language, type Length, type Tone, FORMATS, LENGTHS, TONES } from '../../shared/postTemplates';
import { toLinkedInText } from '../../shared/linkedinText';
import { AiError, getTenantAiConfig } from '../ai';
import type { Candidate } from '../digest';
import { generateAiPostText } from '../postAi';
import { MAX_POST_CHARS } from './text';

/* Writes the LinkedIn posts of a channel run, the same way Generate Post does:
   the company's AI when the channel uses it and a key is configured, the
   shared templates otherwise (and always for the Daily Digest format). */

export interface ComposeOptions {
  format: Format;
  tone: Tone;
  length: Length;
  language: Language;
  useAi: boolean;
}

export const isFormat = (v: unknown): v is Format => (FORMATS as string[]).includes(v as string);
export const isTone = (v: unknown): v is Tone => (TONES as string[]).includes(v as string);
export const isLength = (v: unknown): v is Length => (LENGTHS as string[]).includes(v as string);

export interface ComposedPost {
  text: string;
  articles: Candidate[];
  ai: boolean;
}

function fit(text: string): string {
  const t = toLinkedInText(text);
  return t.length <= MAX_POST_CHARS ? t : `${t.slice(0, MAX_POST_CHARS - 1).trimEnd()}…`;
}

/* `posts` single-article posts (or one digest of up to `posts` articles). */
export async function composePosts(tenantId: number, items: Candidate[], posts: number, o: ComposeOptions): Promise<{ posts: ComposedPost[]; note: string }> {
  if (items.length === 0 || posts < 1) return { posts: [], note: '' };
  if (o.format === 'Daily Digest') {
    /* One post; the template keeps 3/5/7 stories depending on the length. */
    const picked = items;
    return { posts: [{ text: fit(generateDailyDigestPost(picked, o.tone, o.length, o.language)), articles: picked, ai: false }], note: '' };
  }
  const cfg = o.useAi ? getTenantAiConfig(tenantId) : null;
  const out: ComposedPost[] = [];
  let note = '';
  for (const a of items.slice(0, posts)) {
    let text: string | null = null;
    if (cfg) {
      try {
        text = await generateAiPostText(cfg, a, { tone: o.tone, format: o.format, length: o.length, language: o.language });
      } catch (err) {
        /* A broken key must not stop the channel: fall back to the template. */
        note = ` (AI skipped: ${err instanceof AiError ? err.message : 'error'})`;
      }
    }
    const ai = Boolean(text);
    text ??= generateMockPost(a, o.tone, o.format as Exclude<Format, 'Daily Digest'>, o.length, o.language);
    out.push({ text: fit(text), articles: [a], ai });
  }
  return { posts: out, note };
}

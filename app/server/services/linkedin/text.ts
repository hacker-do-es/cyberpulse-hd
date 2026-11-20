/* LinkedIn's Posts API reads `commentary` as "little text format": the
   characters below are markup and must be escaped, and a hashtag only becomes
   a real (clickable) hashtag when written as {hashtag|\#|word}. */

export const MAX_POST_CHARS = 3000;

const RESERVED = /[\\|{}@[\]()<>#*_~]/g;

function escapePlain(s: string): string {
  return s.replace(RESERVED, (c) => `\\${c}`);
}

export function toLittleText(text: string): string {
  const out: string[] = [];
  let last = 0;
  /* #word preceded by start/whitespace/punctuation; letters, digits, _ and accents. */
  const re = /(^|[\s(.,;:!?¡¿"'])#([\p{L}\p{N}_]{1,100})/gu;
  for (const m of text.matchAll(re)) {
    const start = m.index! + m[1].length;
    out.push(escapePlain(text.slice(last, start)));
    out.push(`{hashtag|\\#|${m[2]}}`);
    last = start + 1 + m[2].length;
  }
  out.push(escapePlain(text.slice(last)));
  return out.join('');
}

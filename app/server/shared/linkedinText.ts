/* Shared by the browser and the server (scheduled LinkedIn posts). */

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/* LinkedIn shows Markdown and list markers as literal characters, so publish
   plain text: no **bold** or # headings, and lines that start with "-", "*",
   "•", "→" or "1." get an emoji instead (a safety net for AI-written posts). */
export function toLinkedInText(content: string): string {
  return content
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split('\n')
    .map((line) => line
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^\s*[-*•→▪·]\s+/, '▪️ ')
      .replace(/^\s*(\d)[.)]\s+/, (_m, d: string) => `${KEYCAPS[Number(d)]} `)
      .replace(/^-{3,}\s*$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

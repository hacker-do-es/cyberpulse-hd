import sanitizeHtml from 'sanitize-html';

/* Company-written header/footer HTML for email digests. Only formatting,
   links, images (https) and simple tables survive; no scripts, forms,
   iframes, event handlers or CSS that could hide or overlay content. */

export const MAX_HTML_LENGTH = 10_000;

const ALLOWED_STYLES: Record<string, RegExp[]> = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]{3,20}$/i],
  'text-align': [/^(left|right|center|justify)$/],
  'font-size': [/^\d{1,2}(\.\d)?(px|pt|em|%)$/],
  'font-weight': [/^(normal|bold|[1-9]00)$/],
  'font-style': [/^(normal|italic)$/],
  'font-family': [/^[\w\s,'"-]{1,100}$/],
  'text-decoration': [/^(none|underline)$/],
  'line-height': [/^\d{1,3}(\.\d+)?(px|%|em)?$/],
  width: [/^\d{1,4}(px|%)$/],
  'max-width': [/^\d{1,4}(px|%)$/],
  height: [/^\d{1,4}px$/, /^auto$/],
  margin: [/^(\d{1,3}(px|em)?|auto)( (\d{1,3}(px|em)?|auto)){0,3}$/],
  padding: [/^\d{1,3}(px|em)?( \d{1,3}(px|em)?){0,3}$/],
  border: [/^\d{1,2}px (solid|dashed|dotted) (#[0-9a-f]{3,8}|[a-z]{3,20})$/i],
  'border-radius': [/^\d{1,3}px$/],
  'vertical-align': [/^(top|middle|bottom)$/],
  display: [/^(block|inline-block|inline)$/],
};

export function sanitizeEmailHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: [
      'p', 'br', 'hr', 'div', 'span', 'center', 'b', 'strong', 'i', 'em', 'u', 'small', 'sub', 'sup',
      'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'img',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
    ],
    allowedAttributes: {
      '*': ['style', 'align'],
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['width', 'cellpadding', 'cellspacing', 'border', 'role'],
      td: ['width', 'colspan', 'rowspan', 'valign'],
      th: ['width', 'colspan', 'rowspan', 'valign'],
    },
    allowedStyles: { '*': ALLOWED_STYLES },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowedSchemesByTag: { img: ['https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
    },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    disallowedTagsMode: 'discard',
  }).trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* {company}/{empresa} and {count}/{n}, HTML-escaped. */
export function fillPlaceholdersHtml(html: string, company: string, count: number): string {
  return html
    .replace(/\{(company|empresa)\}/gi, escapeHtml(company))
    .replace(/\{(count|n)\}/gi, String(count));
}

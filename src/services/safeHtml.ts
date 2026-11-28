/**
 * Pure, zero-dependency HTML allowlist sanitizer for local document previews (.docx, .md).
 * Strips scripts, iframes, styles, event handlers, and unsafe URL schemes while keeping
 * semantic layout tags and local data:image/* base64 payloads intact.
 */

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'sub',
  'sup',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'blockquote',
  'pre',
  'code',
  'span',
  'div',
  'a',
  'img',
]);

const STRIP_WITH_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
]);

const SAFE_DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed) || trimmed.startsWith('#')) {
    return trimmed;
  }
  return null;
}

function sanitizeImageSrc(raw: string): string | null {
  const trimmed = raw.trim();
  if (SAFE_DATA_IMAGE_RE.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function sanitizeViaDomParser(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      return (node.textContent || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    if (node.nodeType !== 1) return '';

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (STRIP_WITH_CONTENT_TAGS.has(tag)) return '';

    const childrenHtml = Array.from(el.childNodes).map(walk).join('');
    if (!ALLOWED_TAGS.has(tag)) {
      return childrenHtml;
    }

    if (tag === 'br' || tag === 'hr') {
      return `<${tag} />`;
    }

    if (tag === 'img') {
      const safeSrc = sanitizeImageSrc(el.getAttribute('src') || '');
      if (!safeSrc) return '';
      const alt = escapeAttr((el.getAttribute('alt') || 'Embedded image').slice(0, 140));
      return `<img src="${escapeAttr(safeSrc)}" alt="${alt}" />`;
    }

    const attrs: string[] = [];
    if (tag === 'a') {
      const safeHref = sanitizeHref(el.getAttribute('href') || '');
      if (safeHref) {
        attrs.push(`href="${escapeAttr(safeHref)}"`);
        attrs.push('rel="noopener noreferrer"');
        attrs.push('target="_blank"');
      }
    } else if (tag === 'td' || tag === 'th') {
      const colspan = Number(el.getAttribute('colspan') || '0');
      const rowspan = Number(el.getAttribute('rowspan') || '0');
      if (Number.isInteger(colspan) && colspan > 1 && colspan <= 12) {
        attrs.push(`colspan="${colspan}"`);
      }
      if (Number.isInteger(rowspan) && rowspan > 1 && rowspan <= 12) {
        attrs.push(`rowspan="${rowspan}"`);
      }
    }

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    return `<${tag}${attrStr}>${childrenHtml}</${tag}>`;
  };

  return Array.from(doc.body.childNodes).map(walk).join('');
}

function sanitizeViaRegexFallback(html: string): string {
  let out = html;
  for (const dangerous of STRIP_WITH_CONTENT_TAGS) {
    out = out.replace(new RegExp(`<${dangerous}\\b[^>]*>[\\s\\S]*?<\\/${dangerous}>`, 'gi'), '');
    out = out.replace(new RegExp(`<${dangerous}\\b[^>]*\\/?>`, 'gi'), '');
  }

  out = out.replace(/<(\/?)([a-zA-Z0-9-]+)([^>]*)>/g, (_full, slash: string, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    if (slash) return `</${tag}>`;
    if (tag === 'br' || tag === 'hr') return `<${tag} />`;

    if (tag === 'img') {
      const srcMatch = rawAttrs.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const safeSrc = sanitizeImageSrc(srcMatch?.[1] ?? srcMatch?.[2] ?? '');
      if (!safeSrc) return '';
      const altMatch = rawAttrs.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const alt = escapeAttr((altMatch?.[1] ?? altMatch?.[2] ?? 'Embedded image').slice(0, 140));
      return `<img src="${escapeAttr(safeSrc)}" alt="${alt}" />`;
    }

    if (tag === 'a') {
      const hrefMatch = rawAttrs.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const safeHref = sanitizeHref(hrefMatch?.[1] ?? hrefMatch?.[2] ?? '');
      if (safeHref) {
        return `<a href="${escapeAttr(safeHref)}" rel="noopener noreferrer" target="_blank">`;
      }
      return '<a>';
    }

    if (tag === 'td' || tag === 'th') {
      const attrs: string[] = [];
      const colMatch = rawAttrs.match(/\bcolspan\s*=\s*["']?(\d+)["']?/i);
      const rowMatch = rawAttrs.match(/\browspan\s*=\s*["']?(\d+)["']?/i);
      if (colMatch) {
        const n = Number(colMatch[1]);
        if (n > 1 && n <= 12) attrs.push(`colspan="${n}"`);
      }
      if (rowMatch) {
        const n = Number(rowMatch[1]);
        if (n > 1 && n <= 12) attrs.push(`rowspan="${n}"`);
      }
      return attrs.length > 0 ? `<${tag} ${attrs.join(' ')}>` : `<${tag}>`;
    }

    return `<${tag}>`;
  });

  return out;
}

export function safeSanitizeDocumentHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    return sanitizeViaDomParser(html);
  }
  return sanitizeViaRegexFallback(html);
}

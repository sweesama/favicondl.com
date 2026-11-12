// Shared by the article generator and i18n/validate-output.js.
// Code samples are required to write angle brackets as &lt; and &gt;. Those
// encoded structural tags are valid inside <pre> and <code>. The same tokens
// in prose mean the model turned real markup into visible text.

export const ENCODED_STRUCTURAL_TAG =
  /&lt;\/?(?:p|h2|h3|ul|ol|li|pre|code|a|table|thead|tbody|tr|th|td|blockquote)\b/i;

export const OPAQUE_CONTENT_TAGS = new Set(['pre', 'code']);
export const VOID_CONTENT_TAGS = new Set(['br']);

export function findMatchingClose(source, fromIndex, tag) {
  const re = new RegExp(`<\\/?${tag}\\b[^>]*?>`, 'gi');
  re.lastIndex = fromIndex;
  let nested = 1;
  let match;
  while ((match = re.exec(source)) !== null) {
    const full = match[0];
    if (full.startsWith('</')) nested -= 1;
    else if (!/\/\s*>$/.test(full)) nested += 1;
    if (nested === 0) return re.lastIndex;
  }
  return -1;
}

// Drop the contents of <pre> and <code>, including code nested in pre.
// The wrapper tags stay so a later structural scan still sees the example.
export function htmlWithoutOpaqueContents(html) {
  const source = String(html || '');
  const tagRe = /<\/?([a-zA-Z][\w:-]*)\b[^>]*?>/g;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    const full = match[0];
    const tag = match[1].toLowerCase();
    const isClose = full.startsWith('</');
    const isSelfClosing = /\/\s*>$/.test(full) || VOID_CONTENT_TAGS.has(tag);
    if (isClose || isSelfClosing || !OPAQUE_CONTENT_TAGS.has(tag)) continue;
    const end = findMatchingClose(source, tagRe.lastIndex, tag);
    if (end === -1) continue;
    const closer = source.slice(tagRe.lastIndex, end).match(new RegExp(`</${tag}\\b[^>]*>$`, 'i'));
    result += source.slice(cursor, tagRe.lastIndex);
    if (closer) result += closer[0];
    cursor = end;
    tagRe.lastIndex = end;
  }
  result += source.slice(cursor);
  return result;
}

export function hasEncodedStructuralMarkup(html) {
  if (!html) return false;
  return ENCODED_STRUCTURAL_TAG.test(htmlWithoutOpaqueContents(html));
}

/**
 * Turn the web addresses inside plain text into clickable links.
 *
 * The text is never parsed as HTML: it is split into text nodes and `<a>`
 * elements built with `h()`, and every link goes through `safeUrl()`, so only
 * http(s) addresses can become links.
 */
import { h } from './dom.js';
import { safeUrl } from '../utils/validate.js';

// "https://…", "http://…" or "www.…", up to the next space or quote.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/gi;

// Punctuation that usually ends a sentence rather than the address.
const TRAILING_RE = /[.,;:!?…]+$/;

function trimUrl(raw) {
  let url = raw.replace(TRAILING_RE, '');
  // Drop closing brackets that were opened before the address, as in
  // "(https://zoom.us/j/123)", but keep balanced ones that belong to it.
  while (/[)\]]$/.test(url)) {
    const close = url.endsWith(')') ? ')' : ']';
    const open = close === ')' ? '(' : '[';
    if (url.split(open).length >= url.split(close).length) break;
    url = url.slice(0, -1).replace(TRAILING_RE, '');
  }
  return url;
}

/** Normalise a found address into an https link, or '' if it is not safe. */
export function toHref(text) {
  const value = /^www\./i.test(text) ? `https://${text}` : text;
  return safeUrl(value);
}

/** Return the first web address in `text` as a safe link, or ''. */
export function findFirstUrl(text) {
  for (const match of String(text || '').matchAll(URL_RE)) {
    const href = toHref(trimUrl(match[0]));
    if (href) return href;
  }
  return '';
}

/** A link that opens in a new tab without giving that page access to ours. */
export function externalLink(href, label = href) {
  return h('a', {
    class: 'text-link',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}

/**
 * Split `text` into an array of strings and `<a>` elements, ready to pass to
 * `h()` as children.
 */
export function linkify(text) {
  const source = String(text ?? '');
  const parts = [];
  let last = 0;

  for (const match of source.matchAll(URL_RE)) {
    const shown = trimUrl(match[0]);
    const href = toHref(shown);
    if (!href) continue;
    if (match.index > last) parts.push(source.slice(last, match.index));
    parts.push(externalLink(href, shown));
    last = match.index + shown.length;
  }
  if (last < source.length) parts.push(source.slice(last));
  return parts;
}

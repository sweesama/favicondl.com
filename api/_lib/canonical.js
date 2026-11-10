'use strict';

/**
 * Canonical query strings for /api/favicon, /api/extract and /api/proxy.
 *
 * Vercel's CDN cache key includes the full query string. Ignoring an unknown
 * parameter inside the function does not make two URLs share a cache entry.
 * Callers that are not already canonical get a cached 308 to this path, so a
 * repeat of the same variant is served by the CDN and the expensive handler
 * runs only for the stable URL.
 *
 * Middleware is intentionally not used. It runs before the cache on every
 * matched request and is billed as fluid compute, including requests the CDN
 * would have served for free.
 */

const ALLOWED_SIZES = Object.freeze([16, 32, 48, 64, 128, 180, 192, 256, 512]);

const ENDPOINTS = {
  '/api/favicon': { kind: 'site', defaultFormat: 'json' },
  '/api/extract': { kind: 'site', defaultFormat: 'redirect' },
  '/api/proxy': { kind: 'image', defaultFormat: null },
};

const SITE_PARAMS = ['url', 'domain', 'size', 'format'];
const PROXY_PARAMS = ['url', 'size'];

/**
 * Nearest allowed size. An exact tie uses the smaller size (less CPU and fewer
 * bytes). Values below 16 land on 16 and values above 512 land on 512.
 * @param {number} value already known to be a finite number
 * @returns {number}
 */
function snapSize(value) {
  const n = Math.trunc(value);
  let best = ALLOWED_SIZES[0];
  let bestDist = Infinity;
  for (const size of ALLOWED_SIZES) {
    const dist = Math.abs(size - n);
    if (dist < bestDist || (dist === bestDist && size < best)) {
      best = size;
      bestDist = dist;
    }
  }
  return best;
}

function firstParam(searchParams, name) {
  if (searchParams.has(name)) return searchParams.get(name);
  const wanted = name.toLowerCase();
  for (const [key, value] of searchParams) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/**
 * Site lookups only use the host (the extractor probes apex and www itself).
 * https is the default and is omitted so `github.com` and `https://github.com/`
 * share a key. One leading www is removed for the same reason. A path is kept,
 * without a trailing slash, because a future lookup could care about it; the
 * page query string is kept in its original order.
 * @returns {string|null}
 */
function normalizeSiteTarget(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  let host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return null;
  host = host.replace(/^www\./, '');
  if (!host.includes('.')) return null;
  const port = u.port ? `:${u.port}` : '';
  let path = u.pathname || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '');
  if (path === '/') path = '';
  return `${host}${port}${path}${u.search}`;
}

/**
 * Image URLs keep www and the path: those identify the file. Host case, the
 * scheme and a default port are normalized. A trailing slash is removed only
 * when the path is `/`, so `icon.png/` is not fetched as a different resource.
 * @returns {string|null}
 */
function normalizeProxyTarget(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return null;
  const port = u.port ? `:${u.port}` : '';
  let path = u.pathname || '/';
  if (path === '/') path = '';
  return `${u.protocol}//${host}${port}${path}${u.search}`;
}

/**
 * Absolute proxy URL whose query is already canonical (`url`, then `size`).
 * @param {string} proxyBase origin + /api/proxy, or a full proxy URL
 * @param {string} imageUrl
 * @param {number|null|undefined} size allowed size, or omitted
 */
function buildProxyUrl(proxyBase, imageUrl, size) {
  const base = new URL(proxyBase, 'https://favicondl.com');
  base.hash = '';
  base.search = '';
  const target = normalizeProxyTarget(imageUrl) || String(imageUrl || '');
  const params = new URLSearchParams();
  params.set('url', target);
  if (size) params.set('size', String(size));
  base.search = params.toString();
  return base.toString();
}

/**
 * @param {string} input request URL or path
 * @returns {{ path: string|null, error: string|null }}
 * path is the canonical path when the request can be normalized.
 * error is a message the handler should return as 400 instead of redirecting.
 */
function canonicalApiPath(input) {
  let u;
  try {
    u = new URL(input, 'https://favicondl.com');
  } catch {
    return { path: null, error: null };
  }
  const spec = ENDPOINTS[u.pathname];
  if (!spec) return { path: null, error: null };

  const sizeRaw = firstParam(u.searchParams, 'size');
  let size;
  if (sizeRaw === null || String(sizeRaw).trim() === '') {
    size = undefined;
  } else {
    const parsed = Number(String(sizeRaw).trim());
    if (!Number.isFinite(parsed)) return { path: null, error: 'Invalid size' };
    size = snapSize(parsed);
  }

  let format;
  if (spec.defaultFormat) {
    const formatRaw = firstParam(u.searchParams, 'format');
    if (formatRaw === null || String(formatRaw).trim() === '') {
      format = undefined;
    } else {
      format = String(formatRaw).trim().toLowerCase();
      if (format !== 'json' && format !== 'redirect') return { path: null, error: 'Invalid format' };
      if (format === spec.defaultFormat) format = undefined;
    }
  }

  const params = new URLSearchParams();
  if (spec.kind === 'site') {
    const targetRaw = firstParam(u.searchParams, 'url') || firstParam(u.searchParams, 'domain');
    if (targetRaw === null || String(targetRaw).trim() === '') {
      return { path: u.pathname, error: null };
    }
    const target = normalizeSiteTarget(targetRaw);
    if (!target) return { path: null, error: 'Invalid domain' };
    params.set('url', target);
  } else {
    const targetRaw = firstParam(u.searchParams, 'url');
    if (targetRaw === null || String(targetRaw).trim() === '') {
      return { path: u.pathname, error: null };
    }
    const target = normalizeProxyTarget(targetRaw);
    if (!target) return { path: null, error: 'Invalid url' };
    params.set('url', target);
  }
  if (size) params.set('size', String(size));
  if (format) params.set('format', format);

  const query = params.toString();
  return { path: query ? `${u.pathname}?${query}` : u.pathname, error: null };
}

function requestPath(input) {
  const u = new URL(input, 'https://favicondl.com');
  return `${u.pathname}${u.search}`;
}

module.exports = {
  ALLOWED_SIZES,
  ENDPOINTS,
  SITE_PARAMS,
  PROXY_PARAMS,
  snapSize,
  normalizeSiteTarget,
  normalizeProxyTarget,
  buildProxyUrl,
  canonicalApiPath,
  requestPath,
};

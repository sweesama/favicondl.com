'use strict';

/**
 * CDN cache headers and canonical-URL redirects for the public API.
 *
 * Vercel's CDN caches GET/HEAD responses whose status is 200, 404, 410, 301,
 * 302, 307 or 308. The cache key is the full query string, so a variant URL
 * is answered with a 308 to the canonical query. That redirect is itself
 * cached: a repeat does not run the function. The function runs for the
 * stable URL only.
 *
 * Cache-Control, CDN-Cache-Control and Vercel-CDN-Cache-Control are set
 * together. Vercel gives Vercel-CDN-Cache-Control priority and, once either
 * CDN header is present, forwards Cache-Control unchanged (s-maxage included).
 *
 * Success durations: a day at the edge for a site icon (a week stale), an
 * hour for Google/DuckDuckGo fallbacks, and a week for proxy image bytes.
 * Errors stay short. 4xx/5xx other than 404 and 410 are not stored by
 * Vercel's CDN; the headers are still set for any shared cache that honors
 * them, and proxy.js keeps a short in-process copy of expensive failures.
 */

const { canonicalApiPath, requestPath } = require('./canonical');

const SUCCESS_SITE_CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';
const SUCCESS_FALLBACK_CACHE = 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400';
const PROXY_SUCCESS_CACHE = 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800';
const REDIRECT_CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

function cacheControlForError(status) {
  const code = Number(status) || 500;
  // Timeouts and upstream failures change quickly; cache them for minutes.
  // Missing icons, bad parameters and non-images are stable for about an hour.
  // max-age=0 keeps the browser from sticking on an error.
  if (code >= 500) return 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
  return 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
}

function applyCacheHeaders(res, value) {
  res.setHeader('Cache-Control', value);
  res.setHeader('CDN-Cache-Control', value);
  res.setHeader('Vercel-CDN-Cache-Control', value);
}

/**
 * 308 to the canonical query when this request would be a different CDN key.
 * Returns false when the request is already canonical or should be a 400
 * (the handler reports that error). Runs before any upstream fetch.
 */
function redirectIfNonCanonical(req, res) {
  const current = requestPath(req.url || '/');
  const result = canonicalApiPath(current);
  if (!result.path || result.error || result.path === current) return false;
  applyCacheHeaders(res, REDIRECT_CACHE);
  res.redirect(308, result.path);
  return true;
}

function sendError(res, status, error) {
  applyCacheHeaders(res, cacheControlForError(status));
  return res.status(status).json({ ok: false, error });
}

module.exports = {
  SUCCESS_SITE_CACHE,
  SUCCESS_FALLBACK_CACHE,
  PROXY_SUCCESS_CACHE,
  REDIRECT_CACHE,
  cacheControlForError,
  applyCacheHeaders,
  redirectIfNonCanonical,
  sendError,
};

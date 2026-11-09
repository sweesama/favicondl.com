'use strict';

/**
 * CDN cache headers and cache-bust query stripping for the public API.
 *
 * Vercel's CDN caches GET/HEAD responses whose status is 200, 404, 410, 301,
 * 302, 307 or 308. Other statuses still get Cache-Control so a shared cache
 * that honors s-maxage can store them; the function also keeps a short
 * in-process copy of expensive proxy failures (see proxy.js).
 *
 * Success responses keep the existing durations. Only errors and aggregator
 * fallbacks use the shorter windows.
 */

const CACHE_BUST_PARAMS = ['t', 'v', '_'];

const SUCCESS_SITE_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';
const SUCCESS_FALLBACK_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const REDIRECT_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

function cacheControlForError(status) {
  const code = Number(status) || 500;
  // Timeouts and upstream failures change quickly; cache them for minutes.
  // Missing icons, bad parameters and non-images are stable for about an hour.
  if (code >= 500) return 'public, s-maxage=300, stale-while-revalidate=3600';
  return 'public, s-maxage=3600, stale-while-revalidate=86400';
}

/**
 * Path + query with t, v and _ removed, or null when nothing was stripped.
 * Other parameters (including url, size and format) are kept in their
 * original order so an already-canonical request stays the CDN cache key.
 * @param {string} input request URL or path
 * @returns {string|null}
 */
function cacheBustRedirectPath(input) {
  let u;
  try {
    u = new URL(input, 'https://favicondl.com');
  } catch {
    return null;
  }
  let stripped = false;
  for (const key of CACHE_BUST_PARAMS) {
    if (u.searchParams.has(key)) {
      u.searchParams.delete(key);
      stripped = true;
    }
  }
  if (!stripped) return null;
  return `${u.pathname}${u.search}`;
}

function redirectCacheBusters(req, res) {
  const path = cacheBustRedirectPath(req.url || '/');
  if (!path) return false;
  res.setHeader('cache-control', REDIRECT_CACHE);
  res.redirect(302, path);
  return true;
}

function sendError(res, status, error) {
  res.setHeader('cache-control', cacheControlForError(status));
  return res.status(status).json({ ok: false, error });
}

module.exports = {
  CACHE_BUST_PARAMS,
  SUCCESS_SITE_CACHE,
  SUCCESS_FALLBACK_CACHE,
  REDIRECT_CACHE,
  cacheControlForError,
  cacheBustRedirectPath,
  redirectCacheBusters,
  sendError,
};

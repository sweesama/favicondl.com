'use strict';

const { extractFavicon } = require('./extractor');
const { parseRequestedSize, attachSize, setFaviconSizeHeaders } = require('./resize');
const {
  SUCCESS_SITE_CACHE,
  SUCCESS_FALLBACK_CACHE,
  redirectCacheBusters,
  sendError,
} = require('./httpCache');

const RANK_SIZE = 128;
const DISCOVERY_TIMEOUT_MS = 7000;

// proxyUrl points at the deployment that answered (production, Vercel
// preview, or local dev); unknown hosts fall back to production.
function proxyBaseFor(req) {
  const host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').toLowerCase();
  if (host === 'favicondl.com' || host === 'www.favicondl.com' || /^[a-z0-9-]+\.vercel\.app$/.test(host)) {
    return `https://${host}/api/proxy`;
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}/api/proxy`;
  return 'https://favicondl.com/api/proxy';
}

function clampSize(value) {
  // Kept for older callers. Omitted or invalid values rank like the historical
  // default (128) and do not resize the file.
  const requested = parseRequestedSize(value);
  return requested || RANK_SIZE;
}

/**
 * Shared handler for /api/extract (default format=redirect) and
 * /api/favicon (default format=json, kept for older integrations).
 */
function createHandler({ defaultFormat }) {
  return async function handler(req, res) {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET,OPTIONS');
      res.setHeader('access-control-allow-headers', '*');
      return res.status(204).end();
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET');
      return sendError(res, 405, 'Method not allowed');
    }
    if (redirectCacheBusters(req, res)) return undefined;

    const { searchParams } = new URL(req.url, 'https://favicondl.com');
    const target = searchParams.get('url') || searchParams.get('domain');
    const format = (searchParams.get('format') || defaultFormat).toLowerCase();
    const requested = parseRequestedSize(searchParams.get('size'));

    if (!target) {
      return sendError(res, 400, 'Missing url');
    }
    if (requested === null) {
      return sendError(res, 400, 'Invalid size');
    }
    if (format !== 'redirect' && format !== 'json') {
      return sendError(res, 400, 'Invalid format');
    }

    let data;
    try {
      // Ranking stays on the historical default when size is omitted, so the
      // chosen file does not change for existing callers. An explicit size
      // resizes the largest verified site icon; it does not switch to a
      // smaller Google/DuckDuckGo image.
      data = await extractFavicon(target, {
        size: requested || RANK_SIZE,
        timeoutMs: DISCOVERY_TIMEOUT_MS,
        proxyBase: proxyBaseFor(req),
      });
    } catch {
      return sendError(res, 502, 'Favicon extraction failed');
    }

    if (!data.ok) {
      return sendError(res, data.status || 502, data.error || 'Favicon extraction failed');
    }
    delete data.cached;
    data = attachSize(data, requested);

    const fromSite = data.source !== 'google_s2' && data.source !== 'duckduckgo';
    res.setHeader('cache-control', fromSite ? SUCCESS_SITE_CACHE : SUCCESS_FALLBACK_CACHE);
    setFaviconSizeHeaders(res, data);

    if (format === 'json') {
      return res.status(200).json(data);
    }
    return res.redirect(302, data.proxyUrl || data.iconUrl);
  };
}

module.exports = { createHandler, clampSize, proxyBaseFor, attachSize };

'use strict';

const { extractFavicon } = require('./extractor');

const DEFAULT_SIZE = 128;
const MIN_SIZE = 16;
const MAX_SIZE = 512;
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
  // Number(null) === 0 would clamp a missing size to 16; use the documented default.
  if (value === null || value === undefined || String(value).trim() === '') return DEFAULT_SIZE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(parsed)));
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
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const { searchParams } = new URL(req.url, 'https://favicondl.com');
    const target = searchParams.get('url') || searchParams.get('domain');
    const format = (searchParams.get('format') || defaultFormat).toLowerCase();
    const size = clampSize(searchParams.get('size'));

    if (!target) {
      return res.status(400).json({ ok: false, error: 'Missing url' });
    }
    if (format !== 'redirect' && format !== 'json') {
      return res.status(400).json({ ok: false, error: 'Invalid format' });
    }

    let data;
    try {
      data = await extractFavicon(target, { size, timeoutMs: DISCOVERY_TIMEOUT_MS, proxyBase: proxyBaseFor(req) });
    } catch {
      return res.status(502).json({ ok: false, error: 'Favicon extraction failed' });
    }

    if (!data.ok) {
      return res.status(data.status || 502).json({ ok: false, error: data.error || 'Favicon extraction failed' });
    }
    delete data.cached;

    const fromSite = data.source !== 'google_s2' && data.source !== 'duckduckgo';
    res.setHeader(
      'cache-control',
      fromSite ? 'public, s-maxage=86400, stale-while-revalidate=604800' : 'public, s-maxage=600, stale-while-revalidate=3600'
    );

    if (format === 'json') {
      return res.status(200).json(data);
    }
    return res.redirect(302, data.proxyUrl || data.iconUrl);
  };
}

module.exports = { createHandler, clampSize, proxyBaseFor };

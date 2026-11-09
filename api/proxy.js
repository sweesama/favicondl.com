'use strict';

// GET /api/proxy?url=https://site/icon.png
// Streams an icon with CORS enabled so browser code can draw/download it.
// Only real images are passed through (checked by their bytes, not the
// server's content-type), private/internal addresses are refused, and SVGs
// are served with a sandboxing CSP so they cannot run script on our origin.

const { safeFetch, sniffImage, ACCEPT_IMAGE, MAX_ICON_BYTES } = require('./_lib/extractor');
const { parseRequestedSize, resizeIcon, setFaviconSizeHeaders, nativeSizeLabel } = require('./_lib/resize');
const { redirectCacheBusters, sendError } = require('./_lib/httpCache');

// Leave room under maxDuration (12s) for sniffing and sharp.
const PROXY_TIMEOUT_MS = 7000;
const ERROR_CACHE_MAX = 400;
const errorCache = new Map();

function errorKey(target, size) {
  return `${target}|${size || ''}`;
}

function readError(key) {
  const hit = errorCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    errorCache.delete(key);
    return null;
  }
  return hit;
}

function storeError(key, status, error) {
  if (!key) return;
  if (errorCache.size >= ERROR_CACHE_MAX) errorCache.delete(errorCache.keys().next().value);
  const ttl = status >= 500 ? 5 * 60 * 1000 : 60 * 60 * 1000;
  errorCache.set(key, { status, error, expires: Date.now() + ttl });
}

function fail(res, key, status, error) {
  storeError(key, status, error);
  return sendError(res, status, error);
}

module.exports = async function handler(req, res) {
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
  const target = searchParams.get('url');
  const requested = parseRequestedSize(searchParams.get('size'));
  if (!target) return sendError(res, 400, 'Missing url');
  if (requested === null) return sendError(res, 400, 'Invalid size');

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return sendError(res, 400, 'Invalid url');
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return sendError(res, 403, 'Target is not allowed');
  }

  const key = errorKey(targetUrl.toString(), requested);
  const cached = readError(key);
  if (cached) return sendError(res, cached.status, cached.error);

  const upstream = await safeFetch(targetUrl.toString(), {
    accept: ACCEPT_IMAGE,
    timeoutMs: PROXY_TIMEOUT_MS,
    maxBytes: MAX_ICON_BYTES,
    referer: `${targetUrl.origin}/`,
  });

  if (upstream.error === 'blocked_host' || upstream.error === 'bad_protocol') {
    return fail(res, key, 403, 'Target is not allowed');
  }
  if (upstream.error === 'timeout') {
    return fail(res, key, 504, 'Proxy request timed out');
  }
  if (!upstream.body) {
    return fail(res, key, 502, 'Could not fetch image');
  }
  if (!upstream.ok) {
    const status = upstream.status >= 400 ? upstream.status : 502;
    return fail(res, key, status, `Upstream returned ${upstream.status}`);
  }

  const img = sniffImage(upstream.body);
  if (!img) {
    return fail(res, key, 415, 'Target is not an image');
  }

  res.setHeader('x-content-type-options', 'nosniff');

  if (requested) {
    let png;
    try {
      png = await resizeIcon(upstream.body, img, requested);
    } catch {
      return fail(res, key, 502, 'Could not resize image');
    }
    res.setHeader('cache-control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800');
    const upscaled = !img.vector
      && img.format !== 'svg'
      && img.width > 0
      && img.height > 0
      && Math.max(img.width, img.height) < requested;
    setFaviconSizeHeaders(res, {
      format: img.format,
      vector: !!img.vector,
      width: img.width,
      height: img.height,
      upscaled,
      resized: true,
      outputWidth: requested,
    });
    res.setHeader('content-type', 'image/png');
    res.setHeader('content-length', String(png.length));
    return res.status(200).send(png);
  }

  res.setHeader('cache-control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800');
  res.setHeader('x-favicon-native-size', nativeSizeLabel(img));
  res.setHeader('x-favicon-upscaled', '0');
  res.setHeader('content-type', img.mime);
  res.setHeader('content-length', String(upstream.body.length));
  if (img.format === 'svg') {
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox");
  }
  return res.status(200).send(upstream.body);
};

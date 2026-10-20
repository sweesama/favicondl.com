'use strict';

// GET /api/proxy?url=https://site/icon.png
// Streams an icon with CORS enabled so browser code can draw/download it.
// Only real images are passed through (checked by their bytes, not the
// server's content-type), private/internal addresses are refused, and SVGs
// are served with a sandboxing CSP so they cannot run script on our origin.

const { safeFetch, sniffImage, ACCEPT_IMAGE, MAX_ICON_BYTES } = require('./_lib/extractor');
const { parseRequestedSize, resizeIcon, setFaviconSizeHeaders, nativeSizeLabel } = require('./_lib/resize');

module.exports = async function handler(req, res) {
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
  const target = searchParams.get('url');
  const requested = parseRequestedSize(searchParams.get('size'));
  if (!target) return res.status(400).json({ ok: false, error: 'Missing url' });
  if (requested === null) return res.status(400).json({ ok: false, error: 'Invalid size' });

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid url' });
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return res.status(403).json({ ok: false, error: 'Target is not allowed' });
  }

  const upstream = await safeFetch(targetUrl.toString(), {
    accept: ACCEPT_IMAGE,
    timeoutMs: 8000,
    maxBytes: MAX_ICON_BYTES,
    referer: `${targetUrl.origin}/`,
  });

  if (upstream.error === 'blocked_host' || upstream.error === 'bad_protocol') {
    return res.status(403).json({ ok: false, error: 'Target is not allowed' });
  }
  if (upstream.error === 'timeout') {
    return res.status(504).json({ ok: false, error: 'Proxy request timed out' });
  }
  if (!upstream.body) {
    return res.status(502).json({ ok: false, error: 'Could not fetch image' });
  }
  if (!upstream.ok) {
    return res.status(upstream.status >= 400 ? upstream.status : 502).json({ ok: false, error: `Upstream returned ${upstream.status}` });
  }

  const img = sniffImage(upstream.body);
  if (!img) {
    return res.status(415).json({ ok: false, error: 'Target is not an image' });
  }

  res.setHeader('x-content-type-options', 'nosniff');

  if (requested) {
    let png;
    try {
      png = await resizeIcon(upstream.body, img, requested);
    } catch {
      return res.status(502).json({ ok: false, error: 'Could not resize image' });
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

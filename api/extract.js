const WORKER_BASE_URL = 'https://icy-glade-6d04favicon.sweeyeah.workers.dev';
const DEFAULT_SIZE = 128;
const MIN_SIZE = 16;
const MAX_SIZE = 512;
const REQUEST_TIMEOUT_MS = 9000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { searchParams } = new URL(req.url, 'https://favicondl.com');
  const target = searchParams.get('url') || searchParams.get('domain');
  const format = (searchParams.get('format') || 'redirect').toLowerCase();
  const size = clampSize(searchParams.get('size'));

  if (!target) {
    return res.status(400).json({ ok: false, error: 'Missing url' });
  }

  if (format !== 'redirect' && format !== 'json') {
    return res.status(400).json({ ok: false, error: 'Invalid format' });
  }

  const workerUrl = `${WORKER_BASE_URL}/api/favicon?domain=${encodeURIComponent(target)}&size=${size}`;

  try {
    const response = await fetchWithTimeout(workerUrl, REQUEST_TIMEOUT_MS);
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return res.status(response.ok ? 502 : response.status).json({
        ok: false,
        error: data?.error || 'Favicon extraction failed',
      });
    }

    if (format === 'json') {
      res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=86400');
      return res.status(200).json(data);
    }

    const redirectUrl = data.proxyUrl || data.iconUrl;
    if (!redirectUrl) {
      return res.status(502).json({ ok: false, error: 'No favicon URL returned' });
    }

    res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.redirect(302, redirectUrl);
  } catch {
    return res.status(504).json({ ok: false, error: 'Favicon extraction timed out' });
  }
};

function clampSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(parsed)));
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

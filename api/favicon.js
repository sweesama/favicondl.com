module.exports = async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'https://favicondl.com');
  const domain = searchParams.get('domain');
  const size = searchParams.get('size') || '128';
  const format = searchParams.get('format');

  if (!domain) {
    return res.status(400).json({ ok: false, error: 'Missing domain' });
  }

  const cfWorkerUrl = `https://icy-glade-6d04favicon.sweeyeah.workers.dev/api/favicon?domain=${encodeURIComponent(domain)}&size=${size}`;

  try {
    const response = await fetch(cfWorkerUrl);
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return res.status(response.ok ? 502 : response.status).json({
        ok: false,
        error: data?.error || 'Favicon extraction failed',
      });
    }

    if (format === 'redirect') {
      const redirectUrl = data.proxyUrl || data.iconUrl;
      if (!redirectUrl) {
        return res.status(502).json({ ok: false, error: 'No favicon URL returned' });
      }
      return res.redirect(302, redirectUrl);
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(504).json({ ok: false, error: 'Proxy error' });
  }
}

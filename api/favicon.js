module.exports = async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'https://favicondl.com');
  const domain = searchParams.get('domain');
  const size = searchParams.get('size') || '128';
  const format = searchParams.get('format');

  if (!domain) {
    return res.status(400).json({ ok: false, error: 'Missing domain' });
  }

  const cfWorkerUrl = `https://icy-glade-6d04favicon.sweeyeah.workers.dev/api/favicon?domain=${encodeURIComponent(domain)}&size=${size}`;

  if (format === 'redirect') {
    return res.redirect(cfWorkerUrl + '&format=redirect');
  }

  try {
    const response = await fetch(cfWorkerUrl);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Proxy error' });
  }
}

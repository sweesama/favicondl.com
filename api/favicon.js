module.exports = async function handler(req) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get('domain');
  const size = searchParams.get('size') || '128';
  const format = searchParams.get('format');

  if (!domain) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing domain' }) };
  }

  const cfWorkerUrl = `https://icy-glade-6d04favicon.sweeyeah.workers.dev/api/favicon?domain=${encodeURIComponent(domain)}&size=${size}`;

  if (format === 'redirect') {
    return {
      statusCode: 302,
      headers: { Location: cfWorkerUrl + '&format=redirect' }
    };
  }

  const response = await fetch(cfWorkerUrl);
  const data = await response.json();
  return { statusCode: 200, body: JSON.stringify(data) };
};

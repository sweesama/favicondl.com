const MAX_DISCOVERY_MS = 12000;
const MAX_PROXY_MS = 8000;
const MAX_PROXY_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (url.pathname === '/health') {
      return json({ ok: true }, 200);
    }

    if (url.pathname === '/api/favicon') {
      if (request.method !== 'GET') {
        return json({ ok: false, error: 'Method not allowed' }, 405);
      }

      const rawDomain = (url.searchParams.get('domain') || '').trim();
      const size = clampInt(url.searchParams.get('size'), 16, 512, 128);
      if (!rawDomain) {
        return json({ ok: false, error: 'Missing domain' }, 400);
      }

      const domain = cleanDomain(rawDomain);
      if (!domain) {
        return json({ ok: false, error: 'Invalid domain' }, 400);
      }

      const urlCheckCache = new Map();
      const deadline = Date.now() + MAX_DISCOVERY_MS;

      const htmlCandidates = [];
      const manifestUrls = [];

      const pageUrls = buildPageUrls(domain);
      for (const pageUrl of pageUrls) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        const html = await fetchHtml(pageUrl, Math.min(8000, remainingMs));
        if (!html) continue;

        const found = extractIconUrlsFromHtml(html, pageUrl);
        for (const u of found) htmlCandidates.push(u);

        const manifests = extractManifestUrlsFromHtml(html, pageUrl);
        for (const u of manifests) manifestUrls.push(u);

        const metaFavicon = extractMetaFaviconFromHtml(html);
        if (metaFavicon) htmlCandidates.push(metaFavicon);

        if (htmlCandidates.length >= 40 && manifestUrls.length >= 12) {
          break;
        }
      }

      const manifestIcons = await extractIconUrlsFromManifests(
        Array.from(new Set(manifestUrls)),
        deadline
      );
      for (const u of manifestIcons) htmlCandidates.push(u);

      const directCandidates = buildDirectIconUrls(domain);

      const uniqueHtml = Array.from(new Set(htmlCandidates)).sort(compareIconCandidates);
      const uniqueDirect = Array.from(new Set(directCandidates)).sort(compareIconCandidates);

      let iconUrl = '';
      let source = '';

      let directTries = 0;
      for (const u of uniqueDirect) {
        if (directTries >= 24) break;
        directTries++;
        if (!isProbablyIcon(u)) continue;
        if (deadline - Date.now() <= 0) break;
        const ok = await isImageUrlCached(u, urlCheckCache, deadline);
        if (!ok) continue;
        iconUrl = u;
        source = 'direct';
        break;
      }

      if (!iconUrl) {
        let htmlTries = 0;
        for (const u of uniqueHtml) {
          if (htmlTries >= 30) break;
          htmlTries++;
          if (deadline - Date.now() <= 0) break;
          const ok = await isImageUrlCached(u, urlCheckCache, deadline);
          if (!ok) continue;
          iconUrl = u;
          source = 'html';
          break;
        }
      }

      if (!iconUrl) {
        iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
        source = 'google_s2';
      }

      const origin = `${url.protocol}//${url.host}`;
      const proxyUrl = `${origin}/api/proxy?url=${encodeURIComponent(iconUrl)}`;

      return json(
        {
          ok: true,
          domain,
          size,
          iconUrl,
          proxyUrl,
          source,
        },
        200
      );
    }

    if (url.pathname === '/api/proxy') {
      if (request.method !== 'GET') {
        return json({ ok: false, error: 'Method not allowed' }, 405);
      }

      const target = url.searchParams.get('url');
      if (!target) {
        return json({ ok: false, error: 'Missing url' }, 400);
      }

      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return json({ ok: false, error: 'Invalid url' }, 400);
      }

      if (!['http:', 'https:'].includes(targetUrl.protocol) || isPrivateHostname(targetUrl.hostname)) {
        return json({ ok: false, error: 'Target is not allowed' }, 403);
      }

      const upstream = await fetchWithTimeout(
        targetUrl.toString(),
        {
          headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          accept: '*/*',
        },
        redirect: 'follow',
      },
      MAX_PROXY_MS
      );

      if (!upstream) {
        return json({ ok: false, error: 'Proxy request timed out' }, 504);
      }

      const contentType = upstream.headers.get('content-type') || '';
      const contentLength = Number(upstream.headers.get('content-length') || 0);
      if (!isImageContentType(contentType)) {
        return json({ ok: false, error: 'Target is not an image' }, 415);
      }
      if (contentLength > MAX_PROXY_BYTES) {
        return json({ ok: false, error: 'Image is too large' }, 413);
      }

      const headers = new Headers(upstream.headers);
      headers.set('access-control-allow-origin', '*');
      headers.set('access-control-allow-methods', 'GET,OPTIONS');
      headers.set('access-control-allow-headers', '*');
      headers.set('cache-control', 'public, max-age=3600');

      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    }

    return json({ ok: false, error: 'Not found' }, 404);
  },
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': '*',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function cleanDomain(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0];
  s = s.split(':')[0];
  s = s.toLowerCase();

  if (!s.includes('.')) return '';
  if (!/^[a-z0-9.-]+$/.test(s)) return '';
  return s;
}

async function fetchHtml(pageUrl, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));

  try {
    const res = await fetch(pageUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';

    // 有些站会对 Worker 抓取返回 403，但仍然是 text/html（例如防爬/挑战页）
    // 我们仍然尝试读取，以便提取 manifest/icon 链接
    if (!contentType.includes('text/html')) {
      return '';
    }

    if (!res.ok) {
      try {
        return await res.text();
      } catch {
        return '';
      }
    }

    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function extractMetaFaviconFromHtml(html) {
  const m = String(html).match(/\"favicon\"\s*:\s*\"(https?:\\\/\\\/[^\"]+)\"/i);
  if (!m) return '';
  return m[1].replace(/\\\//g, '/');
}

function extractIconUrlsFromHtml(html, baseUrl) {
  const out = [];

  const add = (u) => {
    try {
      const abs = new URL(u, baseUrl).toString();
      out.push(abs);
    } catch {
    }
  };

  const linkTagRegex = /<link\b[^>]*>/gi;
  const relRegex = /\brel\s*=\s*(["'])(.*?)\1/i;
  const hrefRegex = /\bhref\s*=\s*(["'])(.*?)\1/i;

  for (const tag of String(html).match(linkTagRegex) || []) {
    const relMatch = tag.match(relRegex);
    const hrefMatch = tag.match(hrefRegex);
    if (!relMatch || !hrefMatch) continue;

    const rel = String(relMatch[2] || '').toLowerCase();
    if (!rel.includes('icon')) continue;

    add(hrefMatch[2]);
  }

  return Array.from(new Set(out));
}

function extractManifestUrlsFromHtml(html, baseUrl) {
  const out = [];
  const add = (u) => {
    try {
      out.push(new URL(u, baseUrl).toString());
    } catch {
    }
  };

  const linkTagRegex = /<link\b[^>]*>/gi;
  const relRegex = /\brel\s*=\s*(["'])(.*?)\1/i;
  const hrefRegex = /\bhref\s*=\s*(["'])(.*?)\1/i;

  for (const tag of String(html).match(linkTagRegex) || []) {
    const relMatch = tag.match(relRegex);
    const hrefMatch = tag.match(hrefRegex);
    if (!relMatch || !hrefMatch) continue;
    const rel = String(relMatch[2] || '').toLowerCase();
    if (rel !== 'manifest') continue;
    add(hrefMatch[2]);
  }

  return Array.from(new Set(out));
}

function buildPageUrls(domain) {
  const www = domain.startsWith('www.') ? domain : `www.${domain}`;
  const out = [
    `https://${domain}/`,
    `https://${www}/`,
    `http://${domain}/`,
    `http://${www}/`,
  ];
  return Array.from(new Set(out));
}

function buildDirectIconUrls(domain) {
  const www = domain.startsWith('www.') ? domain : `www.${domain}`;
  const bases = [`https://${domain}`, `https://${www}`, `http://${domain}`, `http://${www}`];
  const paths = [
    '/favicon.ico',
    '/favicon.png',
    '/favicon.svg',
    '/favicon-16x16.png',
    '/favicon-32x32.png',
    '/favicon-192x192.png',
    '/favicon-512x512.png',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
  ];
  const out = [];
  for (const b of bases) {
    for (const p of paths) {
      out.push(`${b}${p}`);
    }
  }
  return Array.from(new Set(out));
}

function isImageContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct) return false;
  if (ct.startsWith('image/')) return true;
  return false;
}

async function isImageUrl(u, deadline = 0) {
  const target = String(u);
  const baseHeaders = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  };

  const headTimeout = deadline ? Math.min(3500, Math.max(100, deadline - Date.now())) : 3500;
  const headRes = await fetchWithTimeout(
    target,
    {
      method: 'HEAD',
      redirect: 'follow',
      headers: baseHeaders,
    },
    headTimeout
  );

  if (headRes) {
    const ct = headRes.headers.get('content-type') || '';
    if (isImageContentType(ct)) return true;
  }

  if (deadline && deadline - Date.now() <= 0) return false;
  const getTimeout = deadline ? Math.min(6000, Math.max(100, deadline - Date.now())) : 6000;
  const getRes = await fetchWithTimeout(
    target,
    {
      method: 'GET',
      redirect: 'follow',
      headers: {
        ...baseHeaders,
        range: 'bytes=0-2048',
      },
    },
    getTimeout
  );

  if (!getRes) return false;
  const ct = getRes.headers.get('content-type') || '';
  return isImageContentType(ct);
}

async function isImageUrlCached(u, cache, deadline = 0) {
  const key = String(u);
  if (cache && cache.has(key)) return cache.get(key);
  const ok = await isImageUrl(key, deadline);
  if (cache) cache.set(key, ok);
  return ok;
}

async function fetchWithTimeout(targetUrl, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(String(targetUrl), {
      ...options,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractIconUrlsFromManifests(urls, deadline = 0) {
  const out = [];

  for (const u of urls || []) {
    if (deadline && deadline - Date.now() <= 0) break;
    const timeoutMs = deadline ? Math.min(6000, Math.max(100, deadline - Date.now())) : 6000;
    const data = await fetchJson(u, timeoutMs);
    if (!data) continue;

    const icons = Array.isArray(data.icons) ? data.icons : [];
    for (const icon of icons) {
      const src = icon && icon.src ? String(icon.src) : '';
      if (!src) continue;
      try {
        out.push(new URL(src, u).toString());
      } catch {
      }
    }
  }

  return Array.from(new Set(out));
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(String(url), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'application/json,text/plain,*/*',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '::1' || host === '0.0.0.0' || host === '::') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return host.endsWith('.local') || host.endsWith('.internal');
}

function compareIconCandidates(a, b) {
  return scoreIconCandidate(b) - scoreIconCandidate(a);
}

function scoreIconCandidate(url) {
  const value = String(url || '').toLowerCase();
  let score = 0;

  if (value.includes('.svg') || value.includes('format=svg')) score += 1000;
  if (value.includes('apple-touch') || value.includes('android-chrome')) score += 450;
  if (value.includes('mask-icon')) score += 400;
  if (value.includes('512')) score += 360;
  else if (value.includes('256')) score += 320;
  else if (value.includes('192')) score += 300;
  else if (value.includes('180')) score += 280;
  else if (value.includes('128')) score += 220;
  else if (value.includes('96')) score += 180;
  else if (value.includes('64')) score += 140;
  else if (value.includes('48')) score += 100;
  else if (value.includes('32')) score += 60;
  else if (value.includes('16')) score += 20;

  if (value.endsWith('.ico') || value.includes('favicon.ico')) score -= 120;
  return score;
}

function isProbablyIcon(url) {
  const u = String(url).toLowerCase();
  return (
    u.includes('favicon') ||
    u.endsWith('.ico') ||
    u.endsWith('.png') ||
    u.endsWith('.svg') ||
    u.endsWith('.webp')
  );
}

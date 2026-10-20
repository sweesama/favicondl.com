'use strict';

/**
 * favicondl icon extractor (runs inside Vercel Node functions).
 *
 * Finds every icon a website declares (HTML <link> tags, web app manifests,
 * well-known paths), downloads each candidate with browser-like headers,
 * checks the bytes really are an image, measures its real pixel size and
 * returns the best one. Google S2 / DuckDuckGo are only used when nothing on
 * the site itself works.
 */

const dns = require('dns').promises;
const net = require('net');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const ACCEPT_IMAGE = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';
const ACCEPT_JSON = 'application/manifest+json,application/json,text/plain,*/*;q=0.8';

const DEFAULT_SIZE = 128;
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_CANDIDATES = 16;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map();
// Verified site icons, shared across requested sizes. A size=512 lookup must
// be able to reuse the 32px icon already found for size=32 instead of trusting
// a Google image that came back smaller.
const siteCache = new Map();

/* ----------------------------------------------------------------------- */
/* Input handling and SSRF protection                                       */
/* ----------------------------------------------------------------------- */

function parseTarget(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return null;
  if (isPrivateHostname(host)) return null;
  return {
    host,
    // `domain` keeps the historical shape: lowercase host without leading www.
    domain: host.replace(/^www\./, ''),
    protocol: u.protocol,
  };
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

const dnsCache = new Map();
async function isPublicHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (isPrivateHostname(host)) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  const hit = dnsCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.ok;
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    ok = false;
  }
  dnsCache.set(host, { ok, expires: Date.now() + 5 * 60 * 1000 });
  return ok;
}

/* ----------------------------------------------------------------------- */
/* HTTP                                                                     */
/* ----------------------------------------------------------------------- */

/**
 * GET with manual redirect handling (every hop is checked against private
 * addresses), a hard deadline and a byte cap. Never throws.
 */
async function safeFetch(targetUrl, { accept, timeoutMs, maxBytes, referer, truncate = false }) {
  const started = Date.now();
  let current = String(targetUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return { ok: false, error: 'bad_url' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'bad_protocol' };
    if (!(await isPublicHost(u.hostname))) return { ok: false, error: 'blocked_host' };

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 50) return { ok: false, error: 'timeout' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let res;
    try {
      const headers = {
        'user-agent': USER_AGENT,
        accept,
        'accept-language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'upgrade-insecure-requests': '1',
      };
      if (referer) headers.referer = referer;
      res = await fetch(u.toString(), { method: 'GET', redirect: 'manual', headers, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: controller.signal.aborted ? 'timeout' : 'network' };
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      try {
        await res.body?.cancel();
      } catch {}
      current = new URL(res.headers.get('location'), u).toString();
      continue;
    }

    try {
      const buf = await readCapped(res, maxBytes, truncate);
      clearTimeout(timer);
      return {
        ok: res.ok,
        status: res.status,
        url: u.toString(),
        contentType: (res.headers.get('content-type') || '').toLowerCase(),
        body: buf,
      };
    } catch {
      clearTimeout(timer);
      return { ok: false, status: res.status, error: controller.signal.aborted ? 'timeout' : 'read' };
    }
  }
  return { ok: false, error: 'too_many_redirects' };
}

/**
 * Reads the body up to maxBytes. With `truncate` (used for HTML) it stops at
 * the cap or right after </head> instead of failing, because icon links live
 * in the head and some homepages are several MB.
 */
async function readCapped(res, maxBytes, truncate = false) {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (truncate) {
      chunks.push(Buffer.from(value));
      const tail = Buffer.from(value).toString('latin1');
      if (total >= maxBytes || /<\/head\s*>/i.test(tail)) {
        try {
          await reader.cancel();
        } catch {}
        break;
      }
      continue;
    }
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {}
      const err = new Error('too_large');
      err.code = 'too_large';
      throw err;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/* ----------------------------------------------------------------------- */
/* Image sniffing                                                           */
/* ----------------------------------------------------------------------- */

/** Returns { format, width, height, mime } or null if the bytes are not an image. */
function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: 'png', mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // ICO / CUR
  if (buf.length >= 6 && buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) {
    const count = buf.readUInt16LE(4);
    if (count > 0 && count < 256 && buf.length >= 6 + count * 16) {
      let best = 0;
      const sizes = [];
      for (let i = 0; i < count; i++) {
        const off = 6 + i * 16;
        let w = buf[off] || 256;
        let h = buf[off + 1] || 256;
        // PNG-compressed entries can be larger than 256; read the real size.
        const dataOff = buf.readUInt32LE(off + 12);
        if (dataOff + 24 <= buf.length && buf[dataOff] === 0x89 && buf[dataOff + 1] === 0x50) {
          w = buf.readUInt32BE(dataOff + 16);
          h = buf.readUInt32BE(dataOff + 20);
        }
        sizes.push(`${w}x${h}`);
        if (Math.max(w, h) > best) best = Math.max(w, h);
      }
      return { format: 'ico', mime: 'image/x-icon', width: best, height: best, sizes };
    }
    return null;
  }
  // GIF
  if (buf.length >= 10 && buf.slice(0, 4).toString('latin1') === 'GIF8') {
    return { format: 'gif', mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', mime: 'image/jpeg', width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
      }
      off += 2 + buf.readUInt16BE(off + 2);
    }
    return { format: 'jpeg', mime: 'image/jpeg', width: 0, height: 0 };
  }
  // WEBP
  if (buf.length >= 30 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('latin1');
    let width = 0;
    let height = 0;
    if (chunk === 'VP8X') {
      width = 1 + buf.readUIntLE(24, 3);
      height = 1 + buf.readUIntLE(27, 3);
    } else if (chunk === 'VP8 ') {
      width = buf.readUInt16LE(26) & 0x3fff;
      height = buf.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      width = 1 + (b & 0x3fff);
      height = 1 + ((b >> 14) & 0x3fff);
    }
    return { format: 'webp', mime: 'image/webp', width, height };
  }
  // AVIF
  if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp' && /avi[fs]/.test(buf.slice(8, 12).toString('latin1'))) {
    return { format: 'avif', mime: 'image/avif', width: 0, height: 0 };
  }
  // BMP
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return { format: 'bmp', mime: 'image/bmp', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
  }
  // SVG (text)
  const head = buf.slice(0, Math.min(buf.length, 4096)).toString('utf8').replace(/^\uFEFF/, '');
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    const tag = (head.match(/<svg\b[^>]*>/i) || [''])[0];
    let width = 0;
    let height = 0;
    const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (vb) {
      width = Math.round(Number(vb[1]));
      height = Math.round(Number(vb[2]));
    }
    return { format: 'svg', mime: 'image/svg+xml', width, height, vector: true };
  }
  return null;
}

/* ----------------------------------------------------------------------- */
/* HTML / manifest parsing                                                  */
/* ----------------------------------------------------------------------- */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function parseAttributes(tag) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  const inner = tag.replace(/^<\s*[a-z0-9-]+/i, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(inner))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function resolveUrl(href, base) {
  const h = String(href || '').trim();
  if (!h || /^(data|javascript|blob|about):/i.test(h)) return '';
  try {
    const u = new URL(h, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function parseSizes(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('any')) return { any: true, max: 0 };
  let max = 0;
  for (const m of s.matchAll(/(\d+)\s*x\s*(\d+)/g)) {
    max = Math.max(max, Math.max(Number(m[1]), Number(m[2])));
  }
  return { any: false, max };
}

/** Parses <base> and every <link> that points at an icon or manifest. */
function parseHtml(html, pageUrl) {
  const text = String(html || '');
  // Only the <head> matters; strip comments and scripts first.
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  let base = pageUrl;
  const baseTag = cleaned.match(/<base\b[^>]*>/i);
  if (baseTag) {
    const href = parseAttributes(baseTag[0]).href;
    const resolved = resolveUrl(href, pageUrl);
    if (resolved) base = resolved;
  }

  const icons = [];
  const manifests = [];
  for (const tag of cleaned.match(/<link\b[^>]*>/gi) || []) {
    const a = parseAttributes(tag);
    const rels = String(a.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!rels.length || !a.href) continue;
    const url = resolveUrl(a.href, base);
    if (!url) continue;
    if (rels.includes('manifest')) {
      manifests.push(url);
      continue;
    }
    let kind = '';
    if (rels.includes('apple-touch-icon') || rels.includes('apple-touch-icon-precomposed')) kind = 'apple-touch-icon';
    else if (rels.includes('mask-icon')) kind = 'mask-icon';
    else if (rels.includes('fluid-icon')) kind = 'fluid-icon';
    else if (rels.includes('icon')) kind = 'icon';
    else continue;
    const sizes = parseSizes(a.sizes);
    icons.push({ url, origin: 'html', rel: kind, type: String(a.type || '').toLowerCase(), declaredSize: sizes.max, declaredAny: sizes.any, media: a.media || '' });
  }

  for (const tag of cleaned.match(/<meta\b[^>]*>/gi) || []) {
    const a = parseAttributes(tag);
    const name = String(a.name || a.itemprop || '').toLowerCase();
    if (name === 'msapplication-tileimage' && a.content) {
      const url = resolveUrl(a.content, base);
      if (url) icons.push({ url, origin: 'html', rel: 'msapplication-tileimage', type: '', declaredSize: 144, declaredAny: false, media: '' });
    }
  }

  return { base, icons, manifests: Array.from(new Set(manifests)) };
}

function parseManifest(buf, manifestUrl) {
  let data;
  try {
    data = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  const out = [];
  for (const icon of Array.isArray(data?.icons) ? data.icons : []) {
    const url = resolveUrl(icon?.src, manifestUrl);
    if (!url) continue;
    const purpose = String(icon.purpose || 'any').toLowerCase();
    const sizes = parseSizes(icon.sizes);
    out.push({
      url,
      origin: 'manifest',
      rel: 'manifest',
      type: String(icon.type || '').toLowerCase(),
      declaredSize: sizes.max,
      declaredAny: sizes.any,
      maskableOnly: !/\bany\b/.test(purpose) && /maskable|monochrome/.test(purpose),
    });
  }
  return out;
}

/* ----------------------------------------------------------------------- */
/* Ranking                                                                  */
/* ----------------------------------------------------------------------- */

function effectiveSize(c) {
  if (c.vector) return 100000;
  return Math.max(c.width || 0, c.height || 0);
}

/**
 * Higher is better. Full-colour SVG wins, then the biggest raster. Masks,
 * maskable-only manifest icons and non-square images are pushed down because
 * they do not look like the site's normal favicon.
 */
function scoreCandidate(c, requested) {
  let score = 0;
  const size = effectiveSize(c);
  if (c.vector) score += 10000;
  else score += Math.min(size, 1024) * 4;
  if (!c.vector && size >= requested) score += 2000;
  if (c.rel === 'mask-icon') score -= 9000; // monochrome Safari pinned-tab icon
  if (c.maskableOnly) score -= 1500;
  if (c.rel === 'fluid-icon' || c.rel === 'msapplication-tileimage') score -= 800;
  if (!c.vector && c.width && c.height && Math.abs(c.width - c.height) > Math.max(c.width, c.height) * 0.1) score -= 3000;
  if (/dark/i.test(c.media || '')) score -= 500; // dark-mode-only variant
  if (c.origin === 'html') score += 30;
  if (c.origin === 'manifest') score += 20;
  return score;
}

function isAggregatorSource(icon) {
  const name = String((icon && (icon.source || icon.origin)) || '');
  return name === 'google_s2' || name === 'duckduckgo';
}

function iconSide(icon) {
  if (!icon) return 0;
  if (icon.vector) return Number.POSITIVE_INFINITY;
  return Math.max(Number(icon.width) || 0, Number(icon.height) || 0);
}

/** Apex and www are both probed. A hung apex must not hide the www icon. */
function pageUrls(target) {
  const alt = target.host.startsWith('www.') ? target.host.slice(4) : `www.${target.host}`;
  return {
    https: [...new Set([`https://${target.host}/`, `https://${alt}/`])],
    http: [`http://${target.host}/`],
  };
}

function directOrigins(target, page) {
  const origins = new Set();
  const add = (host) => {
    const cleaned = String(host || '').toLowerCase().replace(/\.$/, '');
    if (cleaned) origins.add(`https://${cleaned}`);
  };
  add(target.host);
  add(target.domain);
  add(`www.${String(target.domain || '').replace(/^www\./, '')}`);
  if (page && page.finalUrl) {
    try {
      origins.add(new URL(page.finalUrl).origin);
    } catch {
      /* ignore a bad final URL */
    }
  }
  return [...origins];
}

/**
 * Largest verified site icon. An aggregator image is used only when the site
 * contributed nothing — a smaller Google/DuckDuckGo result never replaces one.
 */
function chooseIcon(siteIcons, fallback, requested) {
  const sites = (siteIcons || [])
    .filter((icon) => icon && !isAggregatorSource(icon))
    .slice()
    .sort((a, b) => scoreCandidate(b, requested) - scoreCandidate(a, requested) || iconSide(b) - iconSide(a));
  if (sites.length) return sites[0];
  return fallback || null;
}

function loadSiteIcons(domain) {
  const hit = siteCache.get(domain);
  if (!hit || hit.expires <= Date.now()) return [];
  return hit.icons || [];
}

function rememberSiteIcons(domain, icons, pageUrl) {
  const fresh = (icons || []).filter((icon) => icon && !isAggregatorSource(icon) && (icon.finalUrl || icon.url));
  if (!domain || !fresh.length) return;
  const prev = siteCache.get(domain);
  const previous = prev && prev.expires > Date.now() ? prev.icons : [];
  const merged = new Map();
  for (const icon of [...previous, ...fresh]) {
    const key = icon.finalUrl || icon.url;
    const existing = merged.get(key);
    if (!existing || iconSide(icon) > iconSide(existing)) merged.set(key, icon);
  }
  siteCache.set(domain, {
    icons: [...merged.values()],
    pageUrl: pageUrl || (prev && prev.expires > Date.now() ? prev.pageUrl : null) || null,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

function rememberedPageUrl(domain) {
  const hit = siteCache.get(domain);
  if (!hit || hit.expires <= Date.now()) return null;
  return hit.pageUrl || null;
}

/* ----------------------------------------------------------------------- */
/* Main                                                                     */
/* ----------------------------------------------------------------------- */

async function loadPage(pageUrl, deadline) {
  const remaining = deadline - Date.now();
  if (remaining < 500) return null;
  const res = await safeFetch(pageUrl, {
    accept: ACCEPT_HTML,
    timeoutMs: Math.min(6000, remaining),
    maxBytes: MAX_HTML_BYTES,
    truncate: true,
  });
  if (!res.body) return null;
  const looksHtml = res.contentType.includes('html') || /<html|<head|<link/i.test(res.body.slice(0, 2048).toString('utf8'));
  if (!looksHtml) return null;
  const parsed = parseHtml(res.body.toString('utf8'), res.url);
  return { finalUrl: res.url, status: res.status, ...parsed };
}

/** Resolve with the first page that declares icons, after a short grace period. */
function firstPageWithIcons(promises, graceMs) {
  return new Promise((resolve) => {
    let pending = promises.length;
    if (!pending) return resolve(null);
    let chosen = null;
    let grace = null;
    const finish = (page) => {
      pending -= 1;
      if (page && ((page.icons && page.icons.length) || (page.manifests && page.manifests.length)) && !chosen) {
        chosen = page;
        grace = setTimeout(() => resolve(chosen), graceMs);
      }
      if (pending === 0) {
        if (grace) clearTimeout(grace);
        resolve(chosen);
      }
    };
    for (const promise of promises) promise.then(finish, () => finish(null));
  });
}

async function fetchPage(target, deadline) {
  const { https, http } = pageUrls(target);
  const probes = https.map((url) => loadPage(url, deadline));
  // Apex often hangs while www already has the icon. Don't spend the whole
  // deadline on the first hostname before trying the other one.
  const early = await firstPageWithIcons(probes, 800);
  if (early) return early;
  const settled = (await Promise.all(probes)).filter(Boolean);
  const withIcons = settled.find((page) => page.icons.length || page.manifests.length);
  if (withIcons) return withIcons;
  const usable = settled.find((page) => page.status && page.status < 400) || settled[0];
  if (usable) return usable;
  if (!http.length || deadline - Date.now() < 500) return null;
  return loadPage(http[0], deadline);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function verifyCandidate(c, deadline, referer) {
  const remaining = deadline - Date.now();
  if (remaining < 300) return { ...c, ok: false, error: 'timeout' };
  const res = await safeFetch(c.url, { accept: ACCEPT_IMAGE, timeoutMs: Math.min(5000, remaining), maxBytes: MAX_ICON_BYTES, referer });
  if (!res.ok || !res.body) return { ...c, ok: false, error: res.error || `http_${res.status}` };
  const img = sniffImage(res.body);
  if (!img) return { ...c, ok: false, error: 'not_an_image' };
  if (!img.vector && (img.width || 0) === 0 && img.format !== 'avif' && img.format !== 'jpeg') return { ...c, ok: false, error: 'empty_image' };
  return { ...c, ok: true, finalUrl: res.url, format: img.format, mime: img.mime, width: img.width, height: img.height, vector: !!img.vector, bytes: res.body.length, icoSizes: img.sizes };
}

/** Keeps one candidate per format+size (the best-ranked one) for the picker. */
function dedupeForDisplay(list) {
  const seen = new Set();
  return list.filter((c) => {
    const key = c.vector ? `svg:${c.rel === 'mask-icon' ? 'mask' : 'color'}` : `${c.format}:${c.width}x${c.height}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Up to 8 distinct options, always including an .ico when the site has one. */
function pickForDisplay(list) {
  const unique = dedupeForDisplay(list);
  const picked = unique.slice(0, 7);
  const ico = unique.find((c) => c.format === 'ico' && !picked.includes(c));
  if (ico) picked.push(ico);
  else if (unique[7]) picked.push(unique[7]);
  return picked;
}

async function aggregatorFallback(domain, size, deadline) {
  const sources = [
    { source: 'google_s2', url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}` },
    { source: 'duckduckgo', url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico` },
  ];
  for (const s of sources) {
    const remaining = deadline - Date.now();
    if (remaining < 300) break;
    const res = await safeFetch(s.url, { accept: ACCEPT_IMAGE, timeoutMs: Math.min(3000, remaining), maxBytes: MAX_ICON_BYTES });
    // Google answers 404 with a generic globe when it knows no icon.
    if (res.ok && res.body && sniffImage(res.body)) {
      const img = sniffImage(res.body);
      return { ...s, width: img.width, height: img.height, format: img.format };
    }
  }
  return { ...sources[0], width: 0, height: 0, format: '' };
}

/**
 * @param {string} input domain or URL
 * @param {{size?: number, timeoutMs?: number, proxyBase?: string}} opts
 */
async function extractFavicon(input, opts = {}) {
  const size = opts.size || DEFAULT_SIZE;
  const target = parseTarget(input);
  if (!target) return { ok: false, status: 400, error: 'Invalid domain' };

  const proxyBase = opts.proxyBase || 'https://favicondl.com/api/proxy';
  const cacheKey = `${target.host}|${size}|${proxyBase}`;
  const hit = cache.get(cacheKey);
  const remembered = loadSiteIcons(target.domain);
  if (hit && hit.expires > Date.now()) {
    // A cached Google/DuckDuckGo image loses to a site icon already verified
    // for this domain (Google sz=512 is often 16px; gnu.org's own icon is 32px).
    if (!isAggregatorSource(hit.value) || !remembered.length) {
      return { ...hit.value, cached: true };
    }
    const reused = buildSiteResult(remembered, { finalUrl: rememberedPageUrl(target.domain) }, target, size, proxyBase);
    storeResult(cacheKey, reused, true);
    return { ...reused, cached: true };
  }

  const deadline = Date.now() + (opts.timeoutMs || 8000);
  const page = await fetchPage(target, deadline);

  let candidates = page ? page.icons.slice() : [];

  // Web app manifests (in parallel, small and quick).
  if (page && page.manifests.length) {
    const lists = await Promise.all(
      page.manifests.slice(0, 3).map(async (mUrl) => {
        const remaining = deadline - Date.now();
        if (remaining < 400) return [];
        const res = await safeFetch(mUrl, { accept: ACCEPT_JSON, timeoutMs: Math.min(3000, remaining), maxBytes: MAX_MANIFEST_BYTES, referer: page.finalUrl });
        return res.ok && res.body ? parseManifest(res.body, res.url) : [];
      })
    );
    for (const l of lists) candidates.push(...l);
  }

  // Well-known paths on apex and www, even when the HTML fetch missed one of them.
  const origins = directOrigins(target, page);
  for (const o of origins) {
    candidates.push({ url: `${o}/favicon.ico`, origin: 'direct', rel: 'favicon.ico', type: '', declaredSize: 0 });
    candidates.push({ url: `${o}/apple-touch-icon.png`, origin: 'direct', rel: 'apple-touch-icon', type: '', declaredSize: 180 });
  }

  // De-duplicate by URL, keep the first (most specific) entry.
  const seen = new Set();
  candidates = candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // Verify the most promising candidates first, by declared size/format.
  const declaredScore = (c) =>
    (c.type.includes('svg') || /\.svg(\?|$)/i.test(c.url) ? 5000 : 0) +
    (c.declaredAny ? 4000 : 0) +
    Math.min(c.declaredSize || 32, 1024) * 2 +
    (c.rel === 'mask-icon' ? -6000 : 0) +
    (c.maskableOnly ? -1000 : 0) +
    (c.origin === 'direct' ? -100 : 0);
  const declared = candidates.filter((c) => c.origin !== 'direct').sort((a, b) => declaredScore(b) - declaredScore(a));
  const direct = candidates.filter((c) => c.origin === 'direct');
  const toCheck = [...declared.slice(0, MAX_CANDIDATES - direct.length), ...direct];

  const verified = await mapLimit(toCheck, 6, (c) => verifyCandidate(c, deadline, page ? page.finalUrl : undefined));
  const good = verified.filter((v) => v.ok);
  if (page && page.finalUrl) rememberSiteIcons(target.domain, good, page.finalUrl);
  else rememberSiteIcons(target.domain, good, null);

  // Same bytes under two URLs (e.g. ico + redirect) are fine; we keep both but
  // rank deterministically. Icons found earlier for this domain stay in the pool
  // so a failed HTML fetch cannot throw away a larger site icon.
  const pool = [];
  const seenIcons = new Set();
  for (const icon of [...good, ...loadSiteIcons(target.domain)]) {
    const key = icon.finalUrl || icon.url;
    if (!key || seenIcons.has(key)) continue;
    seenIcons.add(key);
    pool.push(icon);
  }
  pool.sort((a, b) => scoreCandidate(b, size) - scoreCandidate(a, size) || iconSide(b) - iconSide(a));

  let result;
  const bestSite = chooseIcon(pool, null, size);
  if (bestSite) {
    result = buildSiteResult(pool, page || { finalUrl: rememberedPageUrl(target.domain) }, target, size, proxyBase);
  } else {
    const fb = await aggregatorFallback(target.domain, size, Math.max(deadline, Date.now()) + 2500);
    const fallbackIcon = {
      url: fb.url,
      origin: fb.source,
      source: fb.source,
      width: fb.width,
      height: fb.height,
      format: fb.format,
      vector: fb.format === 'svg',
    };
    // chooseIcon drops the fallback whenever a site icon is present, including
    // one remembered from another size while this lookup was in flight.
    const chosen = chooseIcon(loadSiteIcons(target.domain), fallbackIcon, size);
    if (chosen && !isAggregatorSource(chosen)) {
      result = buildSiteResult(loadSiteIcons(target.domain), page || { finalUrl: rememberedPageUrl(target.domain) }, target, size, proxyBase);
    } else {
      result = {
        ok: true,
        domain: target.domain,
        size,
        iconUrl: fb.url,
        proxyUrl: `${proxyBase}?url=${encodeURIComponent(fb.url)}`,
        source: fb.source,
        rel: null,
        format: fb.format || null,
        width: fb.width || null,
        height: fb.height || null,
        vector: fb.format === 'svg',
        pageUrl: page ? page.finalUrl : null,
        candidates: [],
      };
    }
  }

  if (opts.debug) {
    result.debug = {
      pageStatus: page ? page.status : null,
      tried: verified.map((v) => ({ url: v.url, rel: v.rel, origin: v.origin, ok: v.ok, error: v.error, format: v.format, width: v.width, vector: v.vector })),
    };
  }

  storeResult(cacheKey, result, !isAggregatorSource(result));
  return result;
}

function buildSiteResult(icons, page, target, size, proxyBase) {
  const ranked = icons.slice().sort((a, b) => scoreCandidate(b, size) - scoreCandidate(a, size) || iconSide(b) - iconSide(a));
  const best = chooseIcon(ranked, null, size);
  const toPublic = (c) => ({
    url: c.finalUrl || c.url,
    proxyUrl: `${proxyBase}?url=${encodeURIComponent(c.finalUrl || c.url)}`,
    source: c.origin || c.source,
    rel: c.rel,
    format: c.format,
    width: c.vector ? null : c.width,
    height: c.vector ? null : c.height,
    vector: !!c.vector,
    bytes: c.bytes,
  });
  return {
    ok: true,
    domain: target.domain,
    size,
    iconUrl: best.finalUrl || best.url,
    proxyUrl: `${proxyBase}?url=${encodeURIComponent(best.finalUrl || best.url)}`,
    source: best.origin || best.source,
    rel: best.rel || null,
    format: best.format,
    width: best.vector ? null : best.width,
    height: best.vector ? null : best.height,
    vector: !!best.vector,
    pageUrl: page && page.finalUrl ? page.finalUrl : null,
    candidates: pickForDisplay(ranked).map(toPublic),
  };
}

function storeResult(cacheKey, result, fromSite) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  // Cache real-site results for an hour; fallbacks only briefly so a site that
  // was temporarily down gets another chance soon.
  cache.set(cacheKey, {
    value: { ...result, debug: undefined },
    expires: Date.now() + (fromSite ? CACHE_TTL_MS : 5 * 60 * 1000),
  });
}

module.exports = {
  extractFavicon,
  safeFetch,
  sniffImage,
  parseHtml,
  parseManifest,
  parseTarget,
  isPublicHost,
  scoreCandidate,
  chooseIcon,
  pageUrls,
  directOrigins,
  iconSide,
  firstPageWithIcons,
  ACCEPT_IMAGE,
  MAX_ICON_BYTES,
};

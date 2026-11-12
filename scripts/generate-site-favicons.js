'use strict';

/**
 * Download real favicons for the reference pages and write static HTML.
 * Run: node scripts/generate-site-favicons.js
 * Resume a partial run: FAVICON_RESUME=1 node scripts/generate-site-favicons.js
 *
 * Images are saved under favicon/<slug>/files and committed. Pages do not
 * call /api/extract, /api/proxy, or /api/favicon. A site with no image file
 * is omitted.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseIco, pngSize } = require('../js/favicon-converter.js');
const CATALOG = require('./site-favicon-catalog.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'favicon');
const STAGING = path.join(ROOT, 'favicon-build');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const FETCHED = new Date().toISOString().slice(0, 10);
const FETCHED_LABEL = new Date(FETCHED + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});
const RESUME = process.env.FAVICON_RESUME === '1';
const CONCURRENCY = Math.max(1, Number(process.env.FAVICON_CONCURRENCY || 6));

const CATEGORY_LABELS = {
    search: 'Search',
    social: 'Social',
    messaging: 'Messaging',
    video: 'Video',
    music: 'Music',
    shopping: 'Shopping',
    tech: 'Technology',
    ai: 'AI',
    productivity: 'Productivity',
    design: 'Design',
    developer: 'Developer',
    cloud: 'Cloud',
    finance: 'Finance',
    news: 'News',
    sports: 'Sports',
    travel: 'Travel',
    food: 'Food',
    education: 'Education and reference',
    health: 'Health',
    realestate: 'Homes and classifieds',
    logistics: 'Shipping',
    photo: 'Photos and media',
    security: 'Security',
    gaming: 'Gaming',
    reference: 'Reference'
};

const NEIGHBORS = {
    search: ['reference', 'ai', 'news'],
    social: ['messaging', 'video', 'photo'],
    messaging: ['social', 'productivity', 'video'],
    video: ['music', 'social', 'gaming'],
    music: ['video', 'social', 'shopping'],
    shopping: ['food', 'travel', 'tech'],
    tech: ['cloud', 'developer', 'ai'],
    ai: ['developer', 'search', 'productivity'],
    productivity: ['design', 'tech', 'messaging'],
    design: ['productivity', 'photo', 'developer'],
    developer: ['cloud', 'tech', 'ai'],
    cloud: ['developer', 'tech', 'security'],
    finance: ['shopping', 'tech', 'security'],
    news: ['sports', 'reference', 'search'],
    sports: ['news', 'video', 'social'],
    travel: ['food', 'shopping', 'logistics'],
    food: ['shopping', 'travel', 'social'],
    education: ['reference', 'search', 'developer'],
    health: ['reference', 'news', 'education'],
    realestate: ['shopping', 'finance', 'travel'],
    logistics: ['shopping', 'travel', 'tech'],
    photo: ['design', 'social', 'video'],
    security: ['cloud', 'tech', 'finance'],
    gaming: ['video', 'tech', 'social'],
    reference: ['education', 'search', 'news']
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeEntities(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function attr(tag, name) {
    const re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i');
    const match = tag.match(re);
    if (!match) return '';
    return decodeEntities(match[1] || match[2] || match[3] || '').trim();
}

function tags(html, name) {
    const re = new RegExp('<' + name + '\\b[^>]*>', 'gi');
    return html.match(re) || [];
}

function isIconRel(rel) {
    const tokens = String(rel || '').toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.includes('icon') || tokens.includes('apple-touch-icon') || tokens.includes('apple-touch-icon-precomposed') || tokens.includes('mask-icon') || tokens.includes('shortcut');
}

function normalizeColor(value) {
    if (!value) return '';
    const raw = String(value).trim().toLowerCase();
    const hash = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hash) {
        const hex = hash[1].length === 3 ? hash[1].split('').map((ch) => ch + ch).join('') : hash[1];
        return '#' + hex;
    }
    const rgb = raw.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (!rgb) return '';
    const parts = rgb.slice(1, 4).map((n) => Math.max(0, Math.min(255, Number(n))));
    return '#' + parts.map((n) => n.toString(16).padStart(2, '0')).join('');
}

function isNearWhite(hex) {
    const n = parseInt(String(hex).slice(1), 16);
    if (!Number.isFinite(n)) return false;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return r > 245 && g > 245 && b > 245;
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function unfilter(filter, row, prev, bpp) {
    if (filter === 0) return true;
    if (filter > 4) return false;
    for (let i = 0; i < row.length; i++) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        const ul = prev && i >= bpp ? prev[i - bpp] : 0;
        if (filter === 1) row[i] = (row[i] + left) & 255;
        else if (filter === 2) row[i] = (row[i] + up) & 255;
        else if (filter === 3) row[i] = (row[i] + ((left + up) >> 1)) & 255;
        else row[i] = (row[i] + paeth(left, up, ul)) & 255;
    }
    return true;
}

function samplePngColor(buf) {
    if (!buf || buf.length < 8 || buf[0] !== 0x89 || buf.slice(1, 4).toString('ascii') !== 'PNG') return '';
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat = [];
    let palette = null;
    while (offset + 12 <= buf.length) {
        const len = buf.readUInt32BE(offset);
        const type = buf.slice(offset + 4, offset + 8).toString('ascii');
        if (offset + 12 + len > buf.length) return '';
        const data = buf.slice(offset + 8, offset + 8 + len);
        offset += 12 + len;
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === 'PLTE') palette = data;
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
    }
    if (!width || !height || width > 1024 || height > 1024 || interlace !== 0 || bitDepth !== 8) return '';
    if (colorType !== 2 && colorType !== 3 && colorType !== 6) return '';
    let raw;
    try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return ''; }
    const bpp = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
    const stride = width * bpp;
    const rows = [];
    let p = 0;
    for (let y = 0; y < height; y++) {
        if (p >= raw.length) return '';
        const filter = raw[p++];
        if (p + stride > raw.length) return '';
        const row = Buffer.alloc(stride);
        raw.copy(row, 0, p, p + stride);
        p += stride;
        if (!unfilter(filter, row, y > 0 ? rows[y - 1] : null, bpp)) return '';
        rows.push(row);
    }
    const buckets = new Map();
    const stepX = Math.max(1, Math.floor(width / 24));
    const stepY = Math.max(1, Math.floor(height / 24));
    for (let y = 0; y < height; y += stepY) {
        const row = rows[y];
        for (let x = 0; x < width; x += stepX) {
            let r;
            let g;
            let b;
            let a = 255;
            if (colorType === 3) {
                const idx = row[x];
                if (!palette || idx * 3 + 2 >= palette.length) continue;
                r = palette[idx * 3];
                g = palette[idx * 3 + 1];
                b = palette[idx * 3 + 2];
            } else if (colorType === 2) {
                const i = x * 3;
                r = row[i];
                g = row[i + 1];
                b = row[i + 2];
            } else {
                const i = x * 4;
                r = row[i];
                g = row[i + 1];
                b = row[i + 2];
                a = row[i + 3];
            }
            if (a < 128) continue;
            if (r > 245 && g > 245 && b > 245) continue;
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            buckets.set(key, (buckets.get(key) || 0) + 1);
        }
    }
    let best = null;
    let count = 0;
    for (const [key, n] of buckets) {
        if (n > count) {
            best = key;
            count = n;
        }
    }
    if (best == null) return '';
    const r = ((best >> 8) & 15) * 17;
    const g = ((best >> 4) & 15) * 17;
    const b = (best & 15) * 17;
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    return isNearWhite(hex) ? '' : hex;
}

async function fetchBuffer(url, accept, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: ctrl.signal,
            headers: {
                'User-Agent': UA,
                'Accept': accept,
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const buf = Buffer.from(await response.arrayBuffer());
        return {
            url: response.url,
            status: response.status,
            contentType: response.headers.get('content-type') || '',
            buf
        };
    } finally {
        clearTimeout(timer);
    }
}

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function sameSite(url, domains) {
    const host = hostOf(url).replace(/^www\./, '');
    return (domains || []).some((domain) => {
        const d = String(domain || '').replace(/^www\./, '').toLowerCase();
        if (!d) return false;
        return host === d || host.endsWith('.' + d);
    });
}

function detectFormat(buf) {
    if (!buf || buf.length < 8) return null;
    const head = buf.slice(0, 300).toString('utf8').trim().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head')) return null;
    if (buf[0] === 0x89 && buf.slice(1, 4).toString('ascii') === 'PNG') return 'png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
    const gif = buf.slice(0, 6).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1 && parseIco(buf).length > 0) return 'ico';
    if (head.includes('<svg')) return 'svg';
    return null;
}

function jpegSize(buf) {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        if (marker === 0xd9 || marker === 0xda) return null;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (len < 2 || i + 2 + len > buf.length) return null;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
            return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), note: 'JPEG frame header' };
        }
        i += 2 + len;
    }
    return null;
}

function webpSize(buf) {
    if (buf.slice(0, 4).toString('ascii') !== 'RIFF' || buf.slice(8, 12).toString('ascii') !== 'WEBP') return null;
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), note: 'WebP VP8X header' };
    }
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, note: 'WebP lossless header' };
    }
    if (chunk === 'VP8 ') {
        const start = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
        if (start >= 0 && start + 7 <= buf.length) {
            return {
                width: buf.readUInt16LE(start + 3) & 0x3fff,
                height: buf.readUInt16LE(start + 5) & 0x3fff,
                note: 'WebP lossy frame header'
            };
        }
    }
    return null;
}

function measure(format, buf) {
    if (format === 'png') {
        const size = pngSize(buf);
        return size ? { width: size.width, height: size.height, note: 'PNG IHDR' } : null;
    }
    if (format === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), note: 'GIF header' };
    if (format === 'jpeg') return jpegSize(buf);
    if (format === 'webp') return webpSize(buf);
    if (format === 'svg') {
        const text = buf.toString('utf8');
        const widthAttr = text.match(/<svg\b[^>]*\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/i);
        const heightAttr = text.match(/<svg\b[^>]*\bheight\s*=\s*["']([\d.]+)(?:px)?["']/i);
        if (widthAttr && heightAttr) {
            return { width: Number(widthAttr[1]), height: Number(heightAttr[1]), note: 'SVG width and height attributes' };
        }
        const vb = text.match(/\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
        if (vb) return { width: Number(vb[1]), height: Number(vb[2]), note: 'SVG viewBox user units, not a pixel bitmap' };
        return { width: null, height: null, note: 'SVG with no width, height, or viewBox' };
    }
    if (format === 'ico') {
        const images = parseIco(buf).map((img) => ({
            dirWidth: img.dirWidth,
            dirHeight: img.dirHeight,
            pngWidth: img.pngSize ? img.pngSize.width : null,
            pngHeight: img.pngSize ? img.pngSize.height : null,
            payload: img.pngSize ? 'png' : 'bmp',
            png: img.pngSize ? Buffer.from(img.png) : null
        }));
        return { width: null, height: null, note: 'ICO directory', images };
    }
    return null;
}

function extFor(format) {
    if (format === 'jpeg') return 'jpg';
    if (format === 'svg') return 'svg';
    return format;
}

function declaredPixels(sizes, url) {
    const match = String(sizes || '').match(/(\d+)\s*[x×]\s*(\d+)/i) || String(url || '').match(/(\d+)\s*[x×]\s*(\d+)/i);
    if (!match) return 0;
    return Math.max(Number(match[1]) || 0, Number(match[2]) || 0);
}

function candidateRank(candidate) {
    const url = String(candidate.url || '').toLowerCase();
    const via = String(candidate.via || '').toLowerCase();
    const apple = via.includes('apple-touch') || url.includes('apple-touch-icon');
    const ico = url.includes('.ico') || via.includes('shortcut');
    let group = 4;
    if (apple) group = 0;
    else if (ico) group = 1;
    else if (via === 'link' || via === 'mask-icon') group = 2;
    else if (via === 'manifest') group = 3;
    return group * 100000 - declaredPixels(candidate.sizes, url);
}

async function tryDownload(url, domains, allowOffsite) {
    let result;
    try {
        result = await fetchBuffer(url, 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 8000);
    } catch (error) {
        return { error: error.name === 'AbortError' ? 'timeout' : (error.message || 'fetch failed'), url };
    }
    if (result.status !== 200) return { error: 'HTTP ' + result.status, url: result.url || url };
    if (!allowOffsite && !sameSite(result.url, domains)) return { error: 'redirected off site to ' + result.url, url: result.url };
    if (result.buf.length < 16 || result.buf.length > 1500000) return { error: 'unexpected size ' + result.buf.length, url: result.url };
    const format = detectFormat(result.buf);
    if (!format) return { error: 'not an image', url: result.url };
    return { url: result.url, contentType: result.contentType, buf: result.buf, format };
}

function usableSize(measured) {
    if (!measured) return false;
    if (measured.width === 1 && measured.height === 1) return false;
    if (measured.images && measured.images.length) {
        return measured.images.some((img) => (img.pngWidth || img.dirWidth) > 1 && (img.pngHeight || img.dirHeight) > 1);
    }
    if (measured.width == null && measured.height == null) return measured.note && measured.note.startsWith('SVG');
    return true;
}

async function collect(site) {
    const foundLinks = [];
    const manifestIcons = [];
    let htmlStatus = null;
    let htmlUrl = '';
    let manifestUrl = '';
    const candidates = [];
    let themePlain = '';
    let themeMedia = '';
    let tileColor = '';
    const domains = site.domains && site.domains.length ? site.domains : [site.domain];

    for (const pageUrl of site.pages) {
        let page;
        try {
            page = await fetchBuffer(pageUrl, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 10000);
        } catch (error) {
            htmlStatus = error.name === 'AbortError' ? 'timeout' : (error.message || 'fetch failed');
            continue;
        }
        htmlStatus = page.status;
        htmlUrl = page.url || pageUrl;
        if (page.status !== 200 || detectFormat(page.buf)) continue;
        const html = page.buf.toString('utf8');
        const base = page.url || pageUrl;
        for (const tag of tags(html, 'meta')) {
            const name = attr(tag, 'name').toLowerCase();
            if (name === 'theme-color') {
                const color = normalizeColor(attr(tag, 'content'));
                if (!color) continue;
                if (attr(tag, 'media')) { if (!themeMedia) themeMedia = color; }
                else if (!themePlain) themePlain = color;
            } else if (name === 'msapplication-tilecolor' && !tileColor) {
                tileColor = normalizeColor(attr(tag, 'content'));
            }
        }
        for (const tag of tags(html, 'link')) {
            const rel = attr(tag, 'rel');
            const href = attr(tag, 'href');
            if (!href) continue;
            if (String(rel).toLowerCase().split(/\s+/).includes('manifest')) {
                try { manifestUrl = new URL(href, base).href; } catch { /* ignore bad href */ }
                continue;
            }
            if (!isIconRel(rel)) continue;
            let absolute;
            try { absolute = new URL(href, base).href; } catch { continue; }
            const relText = String(rel || '').toLowerCase();
            let via = 'link';
            if (relText.includes('apple-touch')) via = 'apple-touch-icon';
            else if (relText.includes('mask-icon')) via = 'mask-icon';
            else if (relText.includes('shortcut')) via = 'shortcut icon';
            if (foundLinks.length < 60) {
                foundLinks.push({
                    rel,
                    sizes: attr(tag, 'sizes'),
                    type: attr(tag, 'type'),
                    href: absolute,
                    color: attr(tag, 'color')
                });
            }
            candidates.push({ url: absolute, via, allowOffsite: true, sizes: attr(tag, 'sizes') });
        }
        for (const tag of tags(html, 'meta')) {
            const name = attr(tag, 'name').toLowerCase();
            if (!name.startsWith('msapplication-') || !/logo|tileimage/.test(name)) continue;
            const content = attr(tag, 'content');
            if (!content) continue;
            try {
                candidates.push({ url: new URL(content, base).href, via: name, allowOffsite: true, sizes: '' });
            } catch { /* ignore */ }
        }
        if (foundLinks.length || candidates.length) break;
    }

    let manifestTheme = '';
    let manifestBg = '';
    if (manifestUrl) {
        try {
            const manifest = await fetchBuffer(manifestUrl, 'application/manifest+json,application/json,text/plain,*/*;q=0.8', 8000);
            if (manifest.status === 200) {
                const data = JSON.parse(manifest.buf.toString('utf8'));
                manifestTheme = normalizeColor(data.theme_color);
                manifestBg = normalizeColor(data.background_color);
                const icons = Array.isArray(data.icons) ? data.icons : [];
                for (const icon of icons) {
                    if (!icon || !icon.src) continue;
                    let absolute;
                    try { absolute = new URL(icon.src, manifest.url || manifestUrl).href; } catch { continue; }
                    if (manifestIcons.length < 30) {
                        manifestIcons.push({
                            src: absolute,
                            sizes: icon.sizes || '',
                            type: icon.type || '',
                            purpose: icon.purpose || ''
                        });
                    }
                    candidates.push({ url: absolute, via: 'manifest', allowOffsite: true, sizes: icon.sizes || '' });
                }
            }
        } catch { /* manifest is optional */ }
    }

    const origins = new Set();
    for (const pageUrl of site.pages.slice(0, 2)) {
        try { origins.add(new URL(pageUrl).origin); } catch { /* ignore */ }
    }
    if (htmlUrl) {
        try { origins.add(new URL(htmlUrl).origin); } catch { /* ignore */ }
    }
    for (const origin of origins) {
        for (const wellKnown of ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
            candidates.push({ url: origin + wellKnown, via: 'well-known path', allowOffsite: false, sizes: '' });
        }
    }
    candidates.sort((a, b) => candidateRank(a) - candidateRank(b));

    const files = [];
    const seenUrl = new Set();
    const seenHash = new Set();
    let attempts = 0;
    for (const candidate of candidates) {
        if (files.length >= 12 || attempts >= 14) break;
        const key = candidate.url.split('#')[0];
        if (seenUrl.has(key)) continue;
        seenUrl.add(key);
        if (key.startsWith('data:')) {
            const match = key.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
            if (!match) continue;
            const buf = match[2] ? Buffer.from(decodeURIComponent(match[3]), 'base64') : Buffer.from(decodeURIComponent(match[3]));
            const format = detectFormat(buf);
            if (!format) continue;
            const sized = measure(format, buf);
            if (!usableSize(sized)) continue;
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            if (seenHash.has(hash)) continue;
            seenHash.add(hash);
            files.push(storedFile(files.length, { url: 'data URL embedded in the homepage', contentType: match[1] || '', buf, format, via: candidate.via }));
            continue;
        }
        attempts += 1;
        const downloaded = await tryDownload(key, domains, candidate.allowOffsite);
        await sleep(30);
        if (downloaded.error || !downloaded.buf) continue;
        const sized = measure(downloaded.format, downloaded.buf);
        if (!usableSize(sized)) continue;
        const hash = crypto.createHash('sha256').update(downloaded.buf).digest('hex');
        if (seenHash.has(hash)) continue;
        seenHash.add(hash);
        files.push(storedFile(files.length, { ...downloaded, via: candidate.via }));
    }

    if (!files.length) {
        return { slug: site.slug, name: site.name, error: 'no image file downloaded', htmlStatus, htmlUrl };
    }
    const firstIco = files.find((file) => file.format === 'ico' && !String(file.via).startsWith('PNG stored inside'));
    if (firstIco && firstIco.filename !== 'favicon.ico') {
        const previous = firstIco.filename;
        firstIco.filename = 'favicon.ico';
        firstIco.file = 'files/favicon.ico';
        for (const extra of firstIco.extracted || []) {
            extra.via = String(extra.via).replace(previous, 'favicon.ico');
        }
    }

    const mask = foundLinks.find((link) => /mask-icon/i.test(link.rel) && normalizeColor(link.color));
    let brandColor = null;
    if (themePlain) brandColor = { hex: themePlain, source: 'theme-color meta tag' };
    else if (themeMedia) brandColor = { hex: themeMedia, source: 'theme-color meta tag (media query)' };
    else if (mask) brandColor = { hex: normalizeColor(mask.color), source: 'mask-icon color attribute' };
    else if (manifestTheme) brandColor = { hex: manifestTheme, source: 'manifest theme_color' };
    else if (tileColor) brandColor = { hex: tileColor, source: 'msapplication-TileColor' };
    else if (manifestBg && !isNearWhite(manifestBg)) brandColor = { hex: manifestBg, source: 'manifest background_color' };
    else {
        const rasters = [];
        for (const file of files) {
            if (file.format === 'png' && file.buf) rasters.push(file);
            for (const extra of file.extracted || []) {
                if (extra.format === 'png' && extra.buf) rasters.push(extra);
            }
        }
        rasters.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
        for (const file of rasters.slice(0, 4)) {
            const hex = samplePngColor(file.buf);
            if (!hex) continue;
            brandColor = { hex, source: 'most common non-white pixel in ' + file.filename + ', quantised to 4 bits per channel' };
            break;
        }
    }

    const icoFile = files.find((file) => file.format === 'ico' && !String(file.via).startsWith('PNG stored inside'));
    const icoPathFile = files.find((file) => /favicon\.ico/i.test(file.sourceUrl || ''));
    const appleLink = foundLinks.find((link) => /apple-touch-icon/i.test(link.rel));
    const appleSaved = files.find((file) => file.via === 'apple-touch-icon' || /apple-touch-icon/i.test(file.sourceUrl || ''));

    return {
        slug: site.slug,
        name: site.name,
        domain: site.domain,
        host: site.domain,
        category: site.category,
        fetched: FETCHED,
        fetchedLabel: FETCHED_LABEL,
        htmlStatus,
        htmlUrl,
        manifestUrl,
        links: foundLinks,
        manifestIcons,
        files,
        brandColor,
        faviconIcoUrl: icoFile ? icoFile.sourceUrl : (icoPathFile ? icoPathFile.sourceUrl : ''),
        faviconIcoFormat: icoFile ? 'ico' : (icoPathFile ? icoPathFile.format : ''),
        appleTouchIconUrl: (appleSaved && appleSaved.sourceUrl) || (appleLink && appleLink.href) || '',
        appleTouchSaved: Boolean(appleSaved),
        appleTouchFile: (appleSaved && appleSaved.filename) || ''
    };
}

function storedFile(index, downloaded) {
    const measured = measure(downloaded.format, downloaded.buf) || { width: null, height: null, note: 'pixel size not read from this file' };
    const safeIndex = String(index + 1).padStart(2, '0');
    let filename;
    if (downloaded.format === 'ico') filename = index === 0 ? 'favicon.ico' : 'favicon-' + safeIndex + '.ico';
    else if (measured.width && measured.height && measured.note !== 'SVG viewBox user units, not a pixel bitmap') {
        filename = downloaded.format + '-' + measured.width + 'x' + measured.height + '-' + safeIndex + '.' + extFor(downloaded.format);
    } else {
        filename = downloaded.format + '-' + safeIndex + '.' + extFor(downloaded.format);
    }
    const record = {
        file: 'files/' + filename,
        filename,
        sourceUrl: downloaded.url,
        via: downloaded.via,
        format: downloaded.format,
        bytes: downloaded.buf.length,
        contentType: downloaded.contentType || '',
        width: measured.width || null,
        height: measured.height || null,
        dimensionNote: measured.note || '',
        icoImages: [],
        buf: downloaded.buf,
        extracted: []
    };
    if (downloaded.format === 'ico' && measured.images) {
        record.icoImages = measured.images.map((img) => ({
            dirWidth: img.dirWidth,
            dirHeight: img.dirHeight,
            pngWidth: img.pngWidth,
            pngHeight: img.pngHeight,
            payload: img.payload
        }));
        measured.images.forEach((img) => {
            if (img.payload !== 'png' || !img.png) return;
            const w = img.pngWidth || img.dirWidth;
            const h = img.pngHeight || img.dirHeight;
            const name = 'ico-' + w + 'x' + h + '-' + safeIndex + '.png';
            record.extracted.push({
                file: 'files/' + name,
                filename: name,
                sourceUrl: downloaded.url,
                via: 'PNG stored inside ' + filename,
                format: 'png',
                bytes: img.png.length,
                contentType: 'image/png',
                width: w,
                height: h,
                dimensionNote: 'PNG payload inside the ICO. Not resized.',
                buf: img.png
            });
        });
    }
    return record;
}

function writeFiles(dir, site) {
    const folder = path.join(dir, site.slug, 'files');
    fs.mkdirSync(folder, { recursive: true });
    const publicFiles = [];
    for (const file of site.files) {
        fs.writeFileSync(path.join(dir, site.slug, file.file), file.buf);
        const copy = { ...file };
        delete copy.buf;
        delete copy.extracted;
        publicFiles.push(copy);
        for (const extra of file.extracted || []) {
            fs.writeFileSync(path.join(dir, site.slug, extra.file), extra.buf);
            const extraCopy = { ...extra };
            delete extraCopy.buf;
            publicFiles.push(extraCopy);
        }
    }
    return publicFiles;
}

function sizeText(file) {
    if (file.width && file.height) return file.width + '×' + file.height;
    if (file.icoImages && file.icoImages.length) {
        return file.icoImages.map((img) => (img.pngWidth || img.dirWidth) + '×' + (img.pngHeight || img.dirHeight)).join(', ');
    }
    return 'not read from the file header';
}

function buildParagraphs(site) {
    const paragraphs = [site.blurb.trim()];
    const ico = site.files.find((file) => file.format === 'ico' && !String(file.via).startsWith('PNG stored inside'));
    const formats = [...new Set(site.files.map((file) => file.format))];
    let fetchLine = 'Checked ' + site.fetchedLabel + ' against ' + site.host + '.';
    if (site.htmlUrl) {
        fetchLine += ' HTML came from ' + site.htmlUrl + (site.htmlStatus ? ' (HTTP ' + site.htmlStatus + ').' : '.');
    } else if (site.htmlStatus) {
        fetchLine += ' The homepage request ended as ' + site.htmlStatus + ', so discovery continued with icon paths.';
    }
    if (site.links.length) {
        const bits = site.links.slice(0, 6).map((link) => (link.rel || 'icon') + (link.sizes ? ' ' + link.sizes : '') + ' → ' + link.href);
        fetchLine += ' Icon link tags: ' + bits.join('; ') + (site.links.length > 6 ? '. ' + (site.links.length - 6) + ' more are in the table below.' : '.');
    } else {
        fetchLine += ' No icon link tags were readable in the HTML. Files below came from a manifest or from a path that returned an image.';
    }
    paragraphs.push(fetchLine);

    if (ico && String(ico.sourceUrl).startsWith('http')) {
        paragraphs.push('The favicon.ico URL is ' + ico.sourceUrl + '. The saved file ' + ico.filename + ' is ' + ico.bytes + ' bytes. Directory sizes: ' + sizeText(ico) + '.');
    } else if (site.faviconIcoUrl) {
        const matched = site.files.find((file) => file.sourceUrl === site.faviconIcoUrl);
        paragraphs.push('A request to the favicon.ico URL ' + site.faviconIcoUrl + ' returned ' + (matched ? matched.format + ' (' + sizeText(matched) + ', ' + matched.bytes + ' bytes)' : 'a non-ICO image') + ', not an ICO container. Formats that saved: ' + formats.join(', ') + '.');
    } else {
        paragraphs.push('No favicon.ico URL returned an image on ' + site.fetchedLabel + '. ' + site.host + ' did not pass the image check for an .ico path. Formats that did save: ' + formats.join(', ') + '.');
    }

    if (site.appleTouchIconUrl && site.appleTouchSaved) {
        const apple = site.files.find((file) => file.filename === site.appleTouchFile) || site.files.find((file) => file.sourceUrl === site.appleTouchIconUrl);
        const measured = apple && apple.width && apple.height ? ', measured at ' + apple.width + '×' + apple.height + ' ' + apple.format : '';
        paragraphs.push('The apple-touch-icon URL is ' + site.appleTouchIconUrl + measured + '.');
    } else if (site.appleTouchIconUrl) {
        paragraphs.push('An apple-touch-icon URL was declared (' + site.appleTouchIconUrl + '), but that response was not saved as an image, so there is no apple-touch download on this page.');
    } else {
        paragraphs.push('No apple-touch-icon URL was declared, and the well-known apple-touch-icon.png path did not return an image.');
    }

    if (site.brandColor) {
        paragraphs.push('Brand colour ' + site.brandColor.hex + ' comes from the ' + site.brandColor.source + '.');
    } else {
        paragraphs.push('No brand colour could be derived. The page had no theme-color, mask-icon colour, or manifest theme_color, and a dominant pixel colour was not readable from the saved PNGs.');
    }

    const biggest = site.files.filter((file) => file.width && file.height).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    if (biggest) {
        paragraphs.push('Largest measured bitmap: ' + biggest.filename + ' at ' + biggest.width + '×' + biggest.height + ' (' + biggest.format + ', ' + biggest.bytes + ' bytes) from ' + biggest.sourceUrl + '.');
    } else if (ico) {
        paragraphs.push('The only measured sizes are inside ' + ico.filename + ': ' + sizeText(ico) + '.');
    }
    return paragraphs;
}

function questions(site) {
    const measured = site.files.map((file) => file.filename + ' (' + file.format + ', ' + file.bytes + ' bytes, ' + sizeText(file) + ')');
    const ico = site.files.find((file) => file.format === 'ico' && !String(file.via).startsWith('PNG stored inside'));
    const icoAnswer = ico
        ? 'Yes. ' + ico.filename + ' (' + ico.bytes + ' bytes) from ' + ico.sourceUrl + '. Directory sizes: ' + sizeText(ico) + '.'
        : (site.faviconIcoUrl
            ? 'The URL ' + site.faviconIcoUrl + ' did not return an ICO container on ' + site.fetchedLabel + '. The files that did download are listed in the table.'
            : 'No favicon.ico file was saved on ' + site.fetchedLabel + '. ' + site.host + ' did not return an .ico that passed the image check. The files that did download are listed in the table.');
    const appleAnswer = site.appleTouchIconUrl
        ? (site.appleTouchSaved
            ? 'Yes. ' + site.appleTouchIconUrl + (site.appleTouchFile ? ' saved as ' + site.appleTouchFile + '.' : '.')
            : 'Declared at ' + site.appleTouchIconUrl + ', but that response was not saved as an image on ' + site.fetchedLabel + '.')
        : 'No apple-touch-icon URL was found for ' + site.host + ' on ' + site.fetchedLabel + '.';
    const colorAnswer = site.brandColor
        ? site.brandColor.hex + ', from the ' + site.brandColor.source + '.'
        : 'None. No theme-color, mask-icon colour, manifest colour, or readable dominant PNG colour was found on ' + site.fetchedLabel + '.';
    return [
        {
            q: 'What is the ' + site.name + ' favicon.ico URL?',
            a: icoAnswer
        },
        {
            q: 'What are the ' + site.name + ' favicon dimensions?',
            a: 'The pixel sizes below were read from the files, not from a generic size chart. ' + site.files.map((file) => file.filename + ': ' + sizeText(file) + (file.dimensionNote ? ' (' + file.dimensionNote + ')' : '')).join(' ')
        },
        {
            q: 'What apple-touch-icon does ' + site.name + ' publish?',
            a: appleAnswer
        },
        {
            q: 'What brand colour does the ' + site.name + ' favicon page record?',
            a: colorAnswer
        },
        {
            q: 'Which icon files were saved for ' + site.name + '?',
            a: 'On ' + site.fetchedLabel + ' these image files were downloaded for ' + site.host + ': ' + measured.join('; ') + '.'
        },
        {
            q: 'May I use the ' + site.name + ' icon on my own site?',
            a: 'No. Logos and favicons belong to their owners and are shown here for reference so you can see the real format and dimensions. For your own site, make a file with the PNG to favicon converter or download a site you control.'
        }
    ];
}

function metaDescription(site) {
    const ico = site.files.find((file) => file.format === 'ico');
    const sized = site.files.find((file) => file.width && file.height);
    let text = site.name + ' favicon from ' + site.host + ', checked ' + site.fetchedLabel + '.';
    if (ico) text += ' favicon.ico ' + sizeText(ico) + '.';
    else if (sized) text += ' ' + sized.width + '×' + sized.height + ' ' + sized.format + '.';
    if (site.brandColor) text += ' Colour ' + site.brandColor.hex + '.';
    text += ' Logos belong to their owners.';
    if (text.length > 170) text = text.slice(0, 167).replace(/\s+\S*$/, '') + '.';
    return text;
}

function renderPage(site) {
    const title = site.name + ' Favicon (favicon.ico) – Download & Sizes';
    const description = metaDescription(site);
    const canonical = 'https://favicondl.com/favicon/' + site.slug;
    const preview = site.files.find((file) => ['png', 'webp', 'gif', 'jpeg', 'svg'].includes(file.format))
        || site.files.find((file) => file.format === 'ico')
        || site.files[0];
    const faqs = questions(site);
    const previewSizes = [16, 32, 48];
    const paragraphs = buildParagraphs(site);
    const linkRows = site.links.length
        ? site.links.map((link) => '<tr><td>' + esc(link.rel) + '</td><td>' + esc(link.sizes || '—') + '</td><td>' + esc(link.type || '—') + '</td><td>' + esc(link.color || '—') + '</td><td><a href="' + esc(link.href) + '">' + esc(link.href) + '</a></td></tr>').join('')
        : '<tr><td colspan="5">No icon link tags were readable in the homepage HTML'
            + (site.htmlStatus ? ' (last HTML status: ' + esc(String(site.htmlStatus)) + ')' : '')
            + '. Files below came from a manifest or a well-known path that returned an image.</td></tr>';
    const manifestRows = site.manifestIcons.length
        ? '<h2>Manifest icons as declared</h2><p>These sizes are the strings in the manifest. They are not a measurement unless the same URL was downloaded and appears in the file table.</p><div style="overflow-x:auto"><table><thead><tr><th>src</th><th>sizes</th><th>type</th><th>purpose</th></tr></thead><tbody>'
            + site.manifestIcons.map((icon) => '<tr><td><a href="' + esc(icon.src) + '">' + esc(icon.src) + '</a></td><td>' + esc(icon.sizes || '—') + '</td><td>' + esc(icon.type || '—') + '</td><td>' + esc(icon.purpose || '—') + '</td></tr>').join('')
            + '</tbody></table></div>'
        : '';
    const fileRows = site.files.map((file) => '<tr><td><a href="' + esc(file.file) + '" download>' + esc(file.filename) + '</a></td><td>' + esc(file.format) + '</td><td>' + esc(sizeText(file)) + '</td><td>' + esc(file.dimensionNote || '—') + '</td><td>' + file.bytes + '</td><td>' + esc(file.via) + '</td><td>' + (String(file.sourceUrl).startsWith('http') ? '<a href="' + esc(file.sourceUrl) + '">' + esc(file.sourceUrl) + '</a>' : esc(file.sourceUrl)) + '</td></tr>').join('');
    const downloads = site.files.map((file) => '<a class="cta-btn" href="' + esc(file.file) + '" download style="margin:4px">' + esc(file.filename) + '</a>').join(' ');
    const jsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map((item) => ({
            '@type': 'Question',
            name: item.q,
            acceptedAnswer: { '@type': 'Answer', text: item.a }
        }))
    }).replace(/</g, '\\u003c');
    const colorHtml = site.brandColor
        ? '<p>Brand colour <strong>' + esc(site.brandColor.hex) + '</strong> <span style="display:inline-block;width:0.9em;height:0.9em;background:' + esc(site.brandColor.hex) + ';border:1px solid #ccc;vertical-align:-1px;border-radius:2px"></span> — ' + esc(site.brandColor.source) + '.</p>'
        : '<p>No brand colour could be derived from a theme-color tag, a mask-icon colour, a manifest colour, or the saved PNG pixels.</p>';
    const icoHtml = site.faviconIcoUrl
        ? '<p>favicon.ico URL: <a href="' + esc(site.faviconIcoUrl) + '">' + esc(site.faviconIcoUrl) + '</a>' + (site.faviconIcoFormat && site.faviconIcoFormat !== 'ico' ? ' (response format: ' + esc(site.faviconIcoFormat) + ')' : '') + '</p>'
        : '<p>No favicon.ico URL returned an image on this check.</p>';
    const appleHtml = site.appleTouchIconUrl
        ? '<p>apple-touch-icon URL: <a href="' + esc(site.appleTouchIconUrl) + '">' + esc(site.appleTouchIconUrl) + '</a>' + (site.appleTouchSaved ? '' : ' (declared, not saved as an image file)') + '</p>'
        : '<p>No apple-touch-icon URL was found on this check.</p>';
    const related = (site.related || []).map((item) => '<li><a href="/favicon/' + esc(item.slug) + '">' + esc(item.name) + ' favicon</a> <span class="text-gray-500">(' + esc(item.domain) + ')</span></li>').join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="${canonical}">
    <link rel="icon" type="image/x-icon" href="/favicons/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${canonical}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:image" content="https://favicondl.com/favicon/${site.slug}/${preview.file}">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/blog/blog.css?v=20260211">
    <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
    <nav class="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50">
        <div class="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/" class="flex items-center gap-2 font-semibold text-lg text-gray-900"><img src="/favicons/favicon-32x32.png" alt="Mzu favicondl logo" class="w-6 h-6">Mzu favicondl</a>
            <div class="flex items-center gap-8">
                <a href="/documentation.html" class="nav-link">Docs</a>
                <a href="/tools.html" class="nav-link">Tools</a>
                <a href="/blog/" class="nav-link">Blog</a>
                <a href="/favicon/" class="nav-link">Site icons</a>
            </div>
        </div>
    </nav>
    <article class="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <nav class="text-sm text-gray-400 mb-8">
            <a href="/" class="hover:text-gray-600">Home</a><span class="mx-2">/</span>
            <a href="/favicon/" class="hover:text-gray-600">Site favicons</a><span class="mx-2">/</span>
            <span class="text-gray-600">${esc(site.name)}</span>
        </nav>
        <header class="mb-8">
            <p class="text-sm text-gray-400 mb-3">Last checked <time datetime="${esc(site.fetched)}">${esc(site.fetchedLabel)}</time> · ${esc(site.host)}</p>
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">${esc(site.name)} Favicon (favicon.ico)</h1>
        </header>
        <div class="article-body">
            <div class="info-box"><p>Logos and favicons belong to their owners and are shown here for reference. This is not an endorsement and it is not a license to use the mark.</p></div>
            ${paragraphs.map((paragraph) => '<p>' + esc(paragraph) + '</p>').join('\n')}
            <h2>Saved facts</h2>
            ${icoHtml}
            ${appleHtml}
            ${colorHtml}
            <h2>Preview</h2>
            <p>The preview uses the static snapshot <code>${esc(preview.filename)}</code>${preview.width && preview.height ? ', measured at ' + preview.width + '×' + preview.height : ''}. The boxes scale that same saved file in the browser. They are not extra downloads and they do not call the favicon API.</p>
            <div class="flex flex-wrap items-end gap-4 my-4">
                ${previewSizes.map((size) => '<figure class="m-0 text-center"><img src="' + esc(preview.file) + '" alt="' + esc(site.name) + ' favicon preview at ' + size + ' CSS pixels" width="' + size + '" height="' + size + '" style="width:' + size + 'px;height:' + size + 'px;image-rendering:' + (size <= 32 ? 'pixelated' : 'auto') + ';background:#f5f5f7;border:1px solid #e5e5ea;border-radius:8px"><figcaption class="text-xs text-gray-500 mt-1">' + size + ' CSS px</figcaption></figure>').join('')}
            </div>
            <h2>Download</h2>
            <p>Every button is a file saved from the live response on the check date. Nothing here was resized on a server, and the buttons point at those static files.</p>
            <p>${downloads}</p>
            <h2>Files and measured dimensions</h2>
            <div style="overflow-x:auto"><table>
                <thead><tr><th>File</th><th>Format</th><th>Dimensions</th><th>How measured</th><th>Bytes</th><th>Found via</th><th>Source URL</th></tr></thead>
                <tbody>${fileRows}</tbody>
            </table></div>
            <h2>Link tags found</h2>
            <div style="overflow-x:auto"><table>
                <thead><tr><th>rel</th><th>sizes</th><th>type</th><th>color</th><th>href</th></tr></thead>
                <tbody>${linkRows}</tbody>
            </table></div>
            ${manifestRows}
            <h2>How this compares with a normal favicon set</h2>
            <p>A site you publish yourself usually needs a different set from the one ${esc(site.name)} happens to ship: 16×16, 32×32 and 48×48 in one <code>favicon.ico</code>, a 180×180 apple-touch icon, and 192×192 plus 512×512 manifest PNGs. That chart is the <a href="/blog/favicon-sizes-guide.html">favicon dimensions</a> guide. Use these saved files as a reference, then build your own with the <a href="/blog/png-to-favicon.html">PNG to favicon converter</a>.</p>
            <h2>Related site icons</h2>
            <ul>${related}</ul>
            <h2>FAQ</h2>
            ${faqs.map((item) => '<h3>' + esc(item.q) + '</h3><p>' + esc(item.a) + '</p>').join('\n')}
            <p>Look up another domain in the <a href="/">favicon downloader</a>, fetch several at once with the <a href="/bulk-favicon-downloader.html">bulk favicon downloader</a>, or go back to the <a href="/favicon/">site favicon index</a>.</p>
        </div>
    </article>
    <footer class="py-8 px-6 border-t border-gray-100">
        <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <p class="text-gray-400 text-sm">© <script>document.write(new Date().getFullYear())</script> Mzu favicondl</p>
            <div class="flex gap-6">
                <a href="/" class="text-gray-500 hover:text-gray-900 text-sm">Home</a>
                <a href="/tools.html" class="text-gray-500 hover:text-gray-900 text-sm">Tools</a>
                <a href="/blog/favicon-sizes-guide.html" class="text-gray-500 hover:text-gray-900 text-sm">Favicon dimensions</a>
                <a href="/privacy.html" class="text-gray-500 hover:text-gray-900 text-sm">Privacy</a>
            </div>
        </div>
    </footer>
</body>
</html>
`;
}

function renderIndex(sites) {
    const title = 'Site Favicons: Real favicon.ico Files and Sizes (' + sites.length + ' Sites)';
    const description = 'Static favicon snapshots from ' + sites.length + ' popular websites, with measured sizes, favicon.ico URLs and apple-touch icons. Logos belong to their owners.';
    const byCategory = new Map();
    for (const site of sites) {
        if (!byCategory.has(site.category)) byCategory.set(site.category, []);
        byCategory.get(site.category).push(site);
    }
    const sections = Object.keys(CATEGORY_LABELS).filter((key) => byCategory.has(key)).map((key) => {
        const group = byCategory.get(key);
        const cards = group.map((site) => {
            const preview = [...site.files].filter((file) => ['png', 'webp', 'gif', 'jpeg', 'svg', 'ico'].includes(file.format)).sort((a, b) => a.bytes - b.bytes)[0];
            const summary = site.files.slice(0, 2).map((file) => sizeText(file) + ' ' + file.format).join(' · ');
            return '<li><a href="/favicon/' + site.slug + '">'
                + (preview ? '<img src="/favicon/' + site.slug + '/' + preview.file + '" alt="" width="32" height="32" loading="lazy" decoding="async" style="width:32px;height:32px">' : '')
                + '<span><strong>' + esc(site.name) + ' favicon.ico</strong><br><span class="text-gray-500">' + esc(site.host) + ' · ' + esc(summary) + '</span></span></a></li>';
        }).join('\n');
        return '<section id="' + key + '"><h2>' + esc(CATEGORY_LABELS[key]) + '</h2><ul class="favicon-index">' + cards + '</ul></section>';
    }).join('\n');
    const jump = Object.keys(CATEGORY_LABELS).filter((key) => byCategory.has(key)).map((key) => '<a href="#' + key + '">' + esc(CATEGORY_LABELS[key]) + '</a>').join(' · ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://favicondl.com/favicon/">
    <link rel="icon" type="image/x-icon" href="/favicons/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="https://favicondl.com/favicon/">
    <meta property="og:image" content="https://favicondl.com/favicons/android-chrome-512x512.png">
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/blog/blog.css?v=20260211">
    <style>
        .favicon-index { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
        .favicon-index a { display: flex; gap: 12px; align-items: center; background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; padding: 12px; color: inherit; text-decoration: none; }
        .favicon-index a:hover { border-color: #0071e3; }
        .jump a { color: #0071e3; }
    </style>
</head>
<body>
    <nav class="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50">
        <div class="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/" class="flex items-center gap-2 font-semibold text-lg text-gray-900"><img src="/favicons/favicon-32x32.png" alt="Mzu favicondl logo" class="w-6 h-6">Mzu favicondl</a>
            <div class="flex items-center gap-8">
                <a href="/documentation.html" class="nav-link">Docs</a>
                <a href="/tools.html" class="nav-link">Tools</a>
                <a href="/blog/" class="nav-link">Blog</a>
            </div>
        </div>
    </nav>
    <main class="max-w-5xl mx-auto px-6 pt-12 pb-20">
        <header class="mb-10 max-w-3xl">
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900">Real favicons from ${sites.length} websites</h1>
            <p class="text-gray-600 mt-4">Each page stores favicon files downloaded from that site, including the pixel size read from the file, the favicon.ico URL, the apple-touch-icon URL when one existed, and a brand colour when one could be derived. Logos and favicons belong to their owners and are shown here for reference. A site that did not return an image is not listed. Images on these pages are static snapshots. They are not loaded through the favicon API.</p>
            <p class="text-gray-600 mt-3">Last checked <time datetime="${esc(FETCHED)}">${esc(FETCHED_LABEL)}</time>. For any other domain, use the <a href="/" class="text-blue-600 hover:underline">favicon downloader</a>. The size chart for files you publish yourself is the <a href="/blog/favicon-sizes-guide.html" class="text-blue-600 hover:underline">favicon dimensions</a> guide.</p>
            <p class="jump mt-4 text-sm">${jump}</p>
        </header>
        ${sections}
    </main>
    <footer class="py-8 px-6 border-t border-gray-100">
        <div class="max-w-5xl mx-auto flex flex-wrap gap-6">
            <a href="/" class="text-gray-500 hover:text-gray-900 text-sm">Home</a>
            <a href="/bulk-favicon-downloader.html" class="text-gray-500 hover:text-gray-900 text-sm">Bulk downloader</a>
            <a href="/blog/png-to-favicon.html" class="text-gray-500 hover:text-gray-900 text-sm">PNG to favicon</a>
            <a href="/privacy.html" class="text-gray-500 hover:text-gray-900 text-sm">Privacy</a>
        </div>
    </footer>
</body>
</html>
`;
}

function updateSitemap(sites) {
    let xml = fs.readFileSync(SITEMAP, 'utf8');
    const locs = [
        { loc: 'https://favicondl.com/favicon/', lastmod: FETCHED },
        ...sites.map((site) => ({ loc: 'https://favicondl.com/favicon/' + site.slug, lastmod: site.fetched || FETCHED }))
    ];
    const block = [
        '  <!-- site-favicons:start -->',
        ...locs.map((item) => `  <url>\n    <loc>${item.loc}</loc>\n    <lastmod>${item.lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`),
        '  <!-- site-favicons:end -->'
    ].join('\n');
    if (xml.includes('<!-- site-favicons:start -->')) {
        xml = xml.replace(/  <!-- site-favicons:start -->[\s\S]*?  <!-- site-favicons:end -->/, block);
    } else {
        xml = xml.replace('</urlset>', block + '\n</urlset>');
    }
    fs.writeFileSync(SITEMAP, xml);
}

function assignRelated(sites) {
    const byCat = new Map();
    for (const site of sites) {
        if (!byCat.has(site.category)) byCat.set(site.category, []);
        byCat.get(site.category).push(site);
    }
    for (const list of byCat.values()) list.sort((a, b) => a.slug.localeCompare(b.slug));
    const all = [...sites].sort((a, b) => a.slug.localeCompare(b.slug));
    for (const site of sites) {
        const picked = [];
        const seen = new Set([site.slug]);
        const take = (list) => {
            if (!list || !list.length) return;
            let begin = list.findIndex((item) => item.slug > site.slug);
            if (begin < 0) begin = 0;
            for (let i = 0; i < list.length && picked.length < 6; i++) {
                const item = list[(begin + i) % list.length];
                if (seen.has(item.slug)) continue;
                seen.add(item.slug);
                picked.push({ slug: item.slug, name: item.name, domain: item.domain });
            }
        };
        take((byCat.get(site.category) || []).filter((item) => item.slug !== site.slug));
        for (const category of NEIGHBORS[site.category] || []) {
            if (picked.length >= 6) break;
            take(byCat.get(category) || []);
        }
        if (picked.length < 5) take(all);
        site.related = picked.slice(0, 6);
    }
}

function publicMeta(site) {
    const copy = { ...site };
    delete copy.blurb;
    delete copy.files;
    copy.files = site.files.map((file) => {
        const fileCopy = { ...file };
        delete fileCopy.buf;
        delete fileCopy.extracted;
        return fileCopy;
    });
    copy.summary = buildParagraphs(site).join('\n\n');
    return copy;
}

async function pool(items, limit, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    async function worker() {
        while (cursor < items.length) {
            const index = cursor++;
            out[index] = await fn(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return out;
}

function loadMeta(slug) {
    const file = path.join(STAGING, slug, 'meta.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
    if (!RESUME) fs.rmSync(STAGING, { recursive: true, force: true });
    fs.mkdirSync(STAGING, { recursive: true });
    const pending = CATALOG.filter((site) => !(RESUME && loadMeta(site.slug)));
    console.log('catalog ' + CATALOG.length + ', to fetch ' + pending.length + ', concurrency ' + CONCURRENCY);
    const results = await pool(pending, CONCURRENCY, async (site) => {
        process.stdout.write('fetch ' + site.slug + '\n');
        try {
            const result = await collect(site);
            if (!result || result.error || !result.files || !result.files.length) {
                console.log('omit ' + site.slug + ': ' + (result && result.error));
                return { slug: site.slug, name: site.name, error: (result && result.error) || 'no files', htmlStatus: result && result.htmlStatus, htmlUrl: result && result.htmlUrl };
            }
            const files = writeFiles(STAGING, result);
            const meta = { ...result, files };
            delete meta.files;
            meta.files = files;
            fs.writeFileSync(path.join(STAGING, site.slug, 'meta.json'), JSON.stringify(meta));
            console.log('kept ' + site.slug + ' (' + files.length + ' files)');
            return meta;
        } catch (error) {
            console.log('omit ' + site.slug + ': ' + (error.message || String(error)));
            return { slug: site.slug, name: site.name, error: error.message || String(error) };
        }
    });

    const bySlug = new Map();
    for (const site of CATALOG) {
        const cached = loadMeta(site.slug);
        if (cached && cached.files && cached.files.length) bySlug.set(site.slug, cached);
    }
    const omitted = [];
    for (const result of results) {
        if (!result || result.error || !result.files) {
            omitted.push({ slug: result && result.slug, name: result && result.name, reason: (result && result.error) || 'no files', htmlStatus: result && result.htmlStatus, htmlUrl: result && result.htmlUrl });
        }
    }
    for (const site of CATALOG) {
        if (!bySlug.has(site.slug) && !omitted.some((item) => item.slug === site.slug)) {
            omitted.push({ slug: site.slug, name: site.name, reason: 'not fetched' });
        }
    }

    const catalogBySlug = new Map(CATALOG.map((site) => [site.slug, site]));
    const ok = [...bySlug.values()].map((meta) => {
        const src = catalogBySlug.get(meta.slug);
        return {
            ...meta,
            name: src.name,
            domain: src.domain,
            host: src.domain,
            category: src.category,
            blurb: src.blurb
        };
    });
    ok.sort((a, b) => a.name.localeCompare(b.name));
    assignRelated(ok);
    if (ok.length >= 12) {
        for (const site of ok) {
            if (!site.related || site.related.length < 5 || site.related.length > 8) {
                throw new Error('related links out of range for ' + site.slug);
            }
        }
    }

    for (const site of ok) {
        const enriched = { ...site, summary: buildParagraphs(site).join('\n\n') };
        fs.writeFileSync(path.join(STAGING, site.slug, 'index.html'), renderPage(enriched));
        fs.writeFileSync(path.join(STAGING, site.slug, 'meta.json'), JSON.stringify(publicMeta(enriched)));
    }
    fs.writeFileSync(path.join(STAGING, 'index.html'), renderIndex(ok.map((site) => ({ ...site, summary: buildParagraphs(site).join('\n\n') }))));
    const publicSites = ok.map((site) => publicMeta({ ...site, summary: buildParagraphs(site).join('\n\n') }));
    fs.writeFileSync(path.join(STAGING, 'sites.json'), JSON.stringify({ fetched: FETCHED, sites: publicSites }, null, 2));
    fs.writeFileSync(path.join(STAGING, 'omitted.json'), JSON.stringify({ fetched: FETCHED, omitted }, null, 2));

    if (!ok.length) {
        console.error('no pages generated');
        process.exit(1);
    }
    const previous = OUT + '-prev';
    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(OUT)) fs.renameSync(OUT, previous);
    fs.renameSync(STAGING, OUT);
    fs.rmSync(previous, { recursive: true, force: true });
    updateSitemap(ok);
    console.log('pages ' + ok.length + ', omitted ' + omitted.length);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

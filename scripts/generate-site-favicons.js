'use strict';

/**
 * Download real favicons for the reference pages and write static HTML.
 * Run: node scripts/generate-site-favicons.js
 *
 * Images are saved under favicon/<slug>/files and committed. Pages do not
 * call the favicon API. A site with no image file is omitted.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseIco, pngSize } = require('../js/favicon-converter.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'favicon');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const FETCHED = new Date().toISOString().slice(0, 10);
const FETCHED_LABEL = new Date(FETCHED + 'T00:00:00Z').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});

const SITES = [
    { slug: 'amazon', name: 'Amazon', domain: 'amazon.com', pages: ['https://www.amazon.com/', 'https://amazon.com/'], about: 'People look up the Amazon favicon when a shopping bookmark or a seller tool shows an empty tab icon. This page saves the icon files {host} actually returned, so the format and pixel size are measured from those bytes rather than copied from a size chart. The artwork belongs to Amazon and is shown for reference.' },
    { slug: 'youtube', name: 'YouTube', domain: 'youtube.com', pages: ['https://www.youtube.com/', 'https://youtube.com/'], about: 'A YouTube favicon search is usually someone replacing a blank tab icon, or checking whether the site still ships a multi-size .ico. The files here came from {host}. YouTube owns the mark. It is shown for reference, not as a logo to reuse.' },
    { slug: 'google', name: 'Google', domain: 'google.com', pages: ['https://www.google.com/', 'https://google.com/'], about: 'This is the favicon {host} publishes for the Google search homepage. It is not the separate icon used by Gmail, Docs, or Drive. The table lists only files that downloaded as images, with dimensions read from each file.' },
    { slug: 'facebook', name: 'Facebook', domain: 'facebook.com', pages: ['https://www.facebook.com/', 'https://facebook.com/'], about: 'The Facebook favicon is the icon {host} sends for its own site. It is not the Messenger icon and not a file to put on another product. Dimensions below were read from the downloaded bytes. Meta owns the artwork.' },
    { slug: 'instagram', name: 'Instagram', domain: 'instagram.com', pages: ['https://www.instagram.com/', 'https://instagram.com/'], about: 'Instagram’s site icon is what {host} declares for browser tabs and home-screen bookmarks. This page keeps a copy of the files that were actually served, including the address each file came from. The mark belongs to Instagram.' },
    { slug: 'x', name: 'X (Twitter)', domain: 'x.com', pages: ['https://x.com/', 'https://twitter.com/'], about: 'X, formerly Twitter, is looked up under both names. The icons here were fetched from {host}. If a request redirected, the final address is the one in the source column. The mark belongs to its owner and is shown for reference.' },
    { slug: 'linkedin', name: 'LinkedIn', domain: 'linkedin.com', pages: ['https://www.linkedin.com/', 'https://linkedin.com/'], about: 'The LinkedIn favicon is the small mark on {host}, used in tabs and bookmarks. This page records the link tags the homepage exposed and the pixel size of each image file that downloaded. LinkedIn owns the artwork.' },
    { slug: 'github', name: 'GitHub', domain: 'github.com', pages: ['https://github.com/'], about: 'Developers usually want the GitHub favicon when a docs site should not be confused with github.com, or when they are checking which sizes GitHub publishes. These are the files {host} returned. The mark belongs to GitHub.' },
    { slug: 'netflix', name: 'Netflix', domain: 'netflix.com', pages: ['https://www.netflix.com/', 'https://netflix.com/'], about: 'The Netflix favicon is the icon {host} serves for the streaming homepage. Preview boxes scale that file in the browser. The dimension column is the size stored in the file, not the CSS preview size. Netflix owns the mark.' },
    { slug: 'spotify', name: 'Spotify', domain: 'spotify.com', pages: ['https://open.spotify.com/', 'https://www.spotify.com/', 'https://spotify.com/'], about: 'Spotify’s website icon and the installed desktop app icon are not assumed to be the same file. This page only shows what {host} published on the web, with the format detected from the file header. Spotify owns the artwork.' },
    { slug: 'reddit', name: 'Reddit', domain: 'reddit.com', pages: ['https://www.reddit.com/', 'https://reddit.com/'], about: 'The Reddit favicon is a common blank-tab lookup. The copy here is whatever {host} returned on the fetch date, which can differ from an older screenshot. Reddit owns the artwork. It is shown for reference.' },
    { slug: 'wikipedia', name: 'Wikipedia', domain: 'wikipedia.org', pages: ['https://www.wikipedia.org/', 'https://en.wikipedia.org/'], about: 'Wikipedia’s favicon is the mark {host} sends with encyclopedia pages. This page lists link tags found in the HTML and any icon file those tags, or a well-known icon path, actually downloaded. The mark belongs to the Wikimedia Foundation.' },
    { slug: 'tiktok', name: 'TikTok', domain: 'tiktok.com', pages: ['https://www.tiktok.com/', 'https://tiktok.com/'], about: 'The TikTok favicon is the icon {host} serves for its website. It is shown so you can see the real format and dimensions. TikTok owns the mark. Do not reuse it as your own site icon.' },
    { slug: 'apple', name: 'Apple', domain: 'apple.com', pages: ['https://www.apple.com/', 'https://apple.com/'], about: 'Apple’s website favicon is separate from the 180×180 apple-touch-icon any site can publish for iOS. This page is the files {host} itself serves. The standard sizes for your own site are in the favicon dimensions guide. Apple owns this mark.' },
    { slug: 'microsoft', name: 'Microsoft', domain: 'microsoft.com', pages: ['https://www.microsoft.com/', 'https://microsoft.com/'], about: 'The Microsoft favicon is the icon on {host}, not the legacy Windows tile set (70, 144, 150 and 310). Those tile sizes are documented in the favicon dimensions guide. The files here are the ones this host returned. Microsoft owns the mark.' },
    { slug: 'chatgpt', name: 'ChatGPT', domain: 'chatgpt.com', pages: ['https://chatgpt.com/', 'https://chat.openai.com/', 'https://openai.com/'], about: 'This page is the favicon fetched for ChatGPT from {host}, the chat product operated by OpenAI. It is not a generic robot drawing, and it is only the file that host returned. OpenAI owns the artwork. It is shown for reference.' },
    { slug: 'discord', name: 'Discord', domain: 'discord.com', pages: ['https://discord.com/', 'https://www.discord.com/'], about: 'Discord’s favicon is the icon {host} publishes for the web app. Download buttons appear only for files that were saved. Sizes were read from those files. Discord owns the mark.' },
    { slug: 'whatsapp', name: 'WhatsApp', domain: 'whatsapp.com', pages: ['https://web.whatsapp.com/', 'https://www.whatsapp.com/', 'https://whatsapp.com/'], about: 'The WhatsApp favicon is what {host} returns for the web app. The marketing homepage did not return an image to this fetch. A phone’s installed app icon can be a different asset, so this page does not substitute an app-store image. Only the downloaded web icons are shown. WhatsApp owns the mark.' },
    { slug: 'slack', name: 'Slack', domain: 'slack.com', pages: ['https://slack.com/', 'https://www.slack.com/'], about: 'Slack’s favicon is the mark {host} sends for workspace pages in the browser. The table is limited to images fetched for this page, with byte size and pixel size taken from each file. Slack owns the artwork.' },
    { slug: 'pinterest', name: 'Pinterest', domain: 'pinterest.com', pages: ['https://www.pinterest.com/', 'https://pinterest.com/'], about: 'The Pinterest favicon is the icon {host} publishes for boards and pins. It is included here as a reference file with the real URL, format, and dimensions. Pinterest owns the mark.' }
];

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
    return tokens.includes('icon') || tokens.includes('apple-touch-icon') || tokens.includes('apple-touch-icon-precomposed') || tokens.includes('mask-icon');
}

async function fetchBuffer(url, accept, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
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

function sameSite(url, domain) {
    const host = hostOf(url).replace(/^www\./, '');
    return host === domain || host.endsWith('.' + domain);
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

async function tryDownload(url, domain, allowOffsite) {
    let result;
    try {
        result = await fetchBuffer(url, 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 12000);
    } catch (error) {
        return { error: error.name === 'AbortError' ? 'timeout' : (error.message || 'fetch failed'), url };
    }
    if (result.status !== 200) return { error: 'HTTP ' + result.status, url: result.url || url };
    if (!allowOffsite && !sameSite(result.url, domain)) return { error: 'redirected off site to ' + result.url, url: result.url };
    if (result.buf.length < 16 || result.buf.length > 1500000) return { error: 'unexpected size ' + result.buf.length, url: result.url };
    const format = detectFormat(result.buf);
    if (!format) return { error: 'not an image', url: result.url };
    return { url: result.url, contentType: result.contentType, buf: result.buf, format };
}

async function collect(site) {
    const foundLinks = [];
    const manifestIcons = [];
    let htmlStatus = null;
    let htmlUrl = '';
    let manifestUrl = '';
    const candidates = [];

    for (const pageUrl of site.pages) {
        let page;
        try {
            page = await fetchBuffer(pageUrl, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 15000);
        } catch (error) {
            htmlStatus = error.name === 'AbortError' ? 'timeout' : (error.message || 'fetch failed');
            continue;
        }
        htmlStatus = page.status;
        htmlUrl = page.url || pageUrl;
        if (page.status !== 200 || detectFormat(page.buf)) continue;
        const html = page.buf.toString('utf8');
        const base = page.url || pageUrl;
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
            foundLinks.push({
                rel,
                sizes: attr(tag, 'sizes'),
                type: attr(tag, 'type'),
                href: absolute
            });
            candidates.push({ url: absolute, via: 'link', allowOffsite: true });
        }
        for (const tag of tags(html, 'meta')) {
            const name = attr(tag, 'name').toLowerCase();
            if (!name.startsWith('msapplication-') || !/logo|tileimage/.test(name)) continue;
            const content = attr(tag, 'content');
            if (!content) continue;
            try {
                candidates.push({ url: new URL(content, base).href, via: name, allowOffsite: true });
            } catch { /* ignore */ }
        }
        if (foundLinks.length || candidates.length) break;
    }

    if (manifestUrl) {
        try {
            const manifest = await fetchBuffer(manifestUrl, 'application/manifest+json,application/json,text/plain,*/*;q=0.8', 12000);
            if (manifest.status === 200) {
                const data = JSON.parse(manifest.buf.toString('utf8'));
                const icons = Array.isArray(data.icons) ? data.icons : [];
                for (const icon of icons) {
                    if (!icon || !icon.src) continue;
                    let absolute;
                    try { absolute = new URL(icon.src, manifest.url || manifestUrl).href; } catch { continue; }
                    manifestIcons.push({
                        src: absolute,
                        sizes: icon.sizes || '',
                        type: icon.type || '',
                        purpose: icon.purpose || ''
                    });
                    candidates.push({ url: absolute, via: 'manifest', allowOffsite: true });
                }
            }
        } catch { /* manifest is optional */ }
    }

    const originPages = site.pages.slice(0, 2);
    for (const pageUrl of originPages) {
        let origin;
        try { origin = new URL(pageUrl).origin; } catch { continue; }
        for (const wellKnown of ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
            candidates.push({ url: origin + wellKnown, via: 'well-known path', allowOffsite: false });
        }
    }

    const files = [];
    const seenUrl = new Set();
    const seenHash = new Set();
    for (const candidate of candidates) {
        if (files.length >= 12) break;
        const key = candidate.url.split('#')[0];
        if (seenUrl.has(key)) continue;
        seenUrl.add(key);
        if (key.startsWith('data:')) {
            const match = key.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
            if (!match) continue;
            const buf = match[2] ? Buffer.from(decodeURIComponent(match[3]), 'base64') : Buffer.from(decodeURIComponent(match[3]));
            const format = detectFormat(buf);
            if (!format) continue;
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            if (seenHash.has(hash)) continue;
            seenHash.add(hash);
            files.push(storedFile(site, files.length, { url: 'data URL embedded in the homepage', contentType: match[1] || '', buf, format, via: candidate.via }));
            continue;
        }
        const downloaded = await tryDownload(key, site.domain, candidate.allowOffsite);
        await sleep(80);
        if (downloaded.error || !downloaded.buf) continue;
        const hash = crypto.createHash('sha256').update(downloaded.buf).digest('hex');
        if (seenHash.has(hash)) continue;
        seenHash.add(hash);
        files.push(storedFile(site, files.length, { ...downloaded, via: candidate.via }));
    }

    if (!files.length) {
        return { slug: site.slug, name: site.name, error: 'no image file downloaded', htmlStatus, htmlUrl };
    }
    const firstIco = files.find((file) => file.format === 'ico' && !file.via.startsWith('PNG stored inside'));
    if (firstIco && firstIco.filename !== 'favicon.ico') {
        const previous = firstIco.filename;
        firstIco.filename = 'favicon.ico';
        firstIco.file = 'files/favicon.ico';
        for (const extra of firstIco.extracted || []) {
            extra.via = String(extra.via).replace(previous, 'favicon.ico');
        }
    }

    return {
        slug: site.slug,
        name: site.name,
        domain: site.domain,
        host: site.domain,
        fetched: FETCHED,
        fetchedLabel: FETCHED_LABEL,
        htmlStatus,
        htmlUrl,
        manifestUrl,
        links: foundLinks,
        manifestIcons,
        about: site.about,
        files
    };
}

function storedFile(site, index, downloaded) {
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

function writeFiles(site) {
    const dir = path.join(OUT, site.slug, 'files');
    fs.mkdirSync(dir, { recursive: true });
    const publicFiles = [];
    for (const file of site.files) {
        fs.writeFileSync(path.join(OUT, site.slug, file.file), file.buf);
        const copy = { ...file };
        delete copy.buf;
        delete copy.extracted;
        publicFiles.push(copy);
        for (const extra of file.extracted || []) {
            fs.writeFileSync(path.join(OUT, site.slug, extra.file), extra.buf);
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

function questions(site) {
    const measured = site.files.map((file) => file.filename + ' (' + file.format + ', ' + file.bytes + ' bytes, ' + sizeText(file) + ')');
    const ico = site.files.filter((file) => file.format === 'ico');
    const icoAnswer = ico.length
        ? 'Yes. ' + ico.map((file) => file.filename + ' (' + file.bytes + ' bytes) from ' + file.sourceUrl + '. Directory sizes: ' + sizeText(file) + '.').join(' ')
        : 'No favicon.ico file was saved on ' + site.fetchedLabel + '. ' + site.host + ' did not return an .ico that passed the image check. The files that did download are listed in the table.';
    return [
        {
            q: 'What favicon files does ' + site.name + ' publish?',
            a: 'On ' + site.fetchedLabel + ' these image files were downloaded for ' + site.host + ': ' + measured.join('; ') + '.'
        },
        {
            q: 'What are the ' + site.name + ' favicon dimensions?',
            a: 'The pixel sizes below were read from the files, not from a generic size chart. ' + site.files.map((file) => file.filename + ': ' + sizeText(file) + (file.dimensionNote ? ' (' + file.dimensionNote + ')' : '')).join(' ')
        },
        {
            q: 'Can I download the ' + site.name + ' favicon.ico?',
            a: icoAnswer
        },
        {
            q: 'May I use the ' + site.name + ' icon on my own site?',
            a: 'No. The icons belong to their owners and are shown here for reference so you can see the real format and dimensions. For your own site, make a file with the PNG to favicon converter or download a site you control.'
        },
        {
            q: 'How do I get a favicon for a different site?',
            a: 'Paste the domain into the favicon downloader on the favicondl homepage. For several domains, use the bulk favicon downloader. Those tools fetch the live site. This page is a saved copy from ' + site.fetchedLabel + '.'
        }
    ];
}

function renderPage(site) {
    const title = site.name + ' Favicon.ico — Real Sizes and Download';
    const bits = site.files.slice(0, 3).map((file) => (file.width && file.height ? file.width + '×' + file.height + ' ' + file.format : file.format));
    let description = site.name + ' favicon files from ' + site.host + ', fetched ' + site.fetchedLabel + '. Measured: ' + bits.join(', ') + '. Icons belong to their owners.';
    if (description.length > 170) description = description.slice(0, 167).replace(/\s+\S*$/, '') + '.';
    const canonical = 'https://favicondl.com/favicon/' + site.slug;
    const preview = site.files.find((file) => ['png', 'webp', 'gif', 'jpeg', 'svg', 'ico'].includes(file.format)) || site.files[0];
    const faqs = questions(site);
    const previewSizes = [16, 32, 48, 180];
    const linkRows = site.links.length
        ? site.links.map((link) => '<tr><td>' + esc(link.rel) + '</td><td>' + esc(link.sizes || '—') + '</td><td>' + esc(link.type || '—') + '</td><td><a href="' + esc(link.href) + '" rel="noopener">' + esc(link.href) + '</a></td></tr>').join('')
        : '<tr><td colspan="4">No icon link tags were readable in the homepage HTML'
            + (site.htmlStatus ? ' (last HTML status: ' + esc(String(site.htmlStatus)) + ')' : '')
            + '. Files below, if any, came from a manifest or a well-known path that returned an image.</td></tr>';
    const manifestRows = site.manifestIcons.length
        ? '<h2>Manifest icons as declared</h2><p>These sizes are the strings in the manifest. They are not a measurement unless the same URL was downloaded and appears in the file table.</p><div style="overflow-x:auto"><table><thead><tr><th>src</th><th>sizes</th><th>type</th><th>purpose</th></tr></thead><tbody>'
            + site.manifestIcons.map((icon) => '<tr><td><a href="' + esc(icon.src) + '" rel="noopener">' + esc(icon.src) + '</a></td><td>' + esc(icon.sizes || '—') + '</td><td>' + esc(icon.type || '—') + '</td><td>' + esc(icon.purpose || '—') + '</td></tr>').join('')
            + '</tbody></table></div>'
        : '';
    const fileRows = site.files.map((file) => '<tr><td><a href="' + esc(file.file) + '" download>' + esc(file.filename) + '</a></td><td>' + esc(file.format) + '</td><td>' + esc(sizeText(file)) + '</td><td>' + esc(file.dimensionNote || '—') + '</td><td>' + file.bytes + '</td><td>' + esc(file.via) + '</td><td>' + (String(file.sourceUrl).startsWith('http') ? '<a href="' + esc(file.sourceUrl) + '" rel="noopener">' + esc(file.sourceUrl) + '</a>' : esc(file.sourceUrl)) + '</td></tr>').join('');
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
    const hasIco = site.files.some((file) => file.format === 'ico');
    const icoNote = hasIco
        ? ''
        : '<div class="info-box"><p>No <code>favicon.ico</code> was saved on ' + esc(site.fetchedLabel) + '. The heading matches the search for “' + esc(site.name) + ' favicon.ico”, and the files below are what ' + esc(site.host) + ' actually returned.</p></div>';

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
            <p class="text-sm text-gray-400 mb-3">Fetched ${esc(site.fetchedLabel)} · ${esc(site.host)}</p>
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">${esc(site.name)} favicon.ico</h1>
        </header>
        <div class="article-body">
            <div class="info-box"><p>Icons belong to their owners and are shown for reference. This is not an endorsement, and the files are not a license to use the mark.</p></div>
            ${icoNote}
            <p>${esc(site.about.replaceAll('{host}', site.host))}</p>
            <h2>Preview</h2>
            <p>The image is <code>${esc(preview.filename)}</code>${preview.width && preview.height ? ', measured at ' + preview.width + '×' + preview.height : ''}. The boxes scale that same file in the browser. They are not extra files unless a row in the table says so.</p>
            <div class="flex flex-wrap items-end gap-4 my-4">
                ${previewSizes.map((size) => '<figure class="m-0 text-center"><img src="' + esc(preview.file) + '" alt="' + esc(site.name) + ' favicon preview at ' + size + ' CSS pixels" width="' + size + '" height="' + size + '" style="width:' + size + 'px;height:' + size + 'px;image-rendering:' + (size <= 32 ? 'pixelated' : 'auto') + ';background:#f5f5f7;border:1px solid #e5e5ea;border-radius:8px"><figcaption class="text-xs text-gray-500 mt-1">' + size + ' CSS px</figcaption></figure>').join('')}
            </div>
            <h2>Download</h2>
            <p>Every button is a file saved from the live response. Nothing here was resized on a server.</p>
            <p>${downloads}</p>
            <h2>Files and measured dimensions</h2>
            <div style="overflow-x:auto"><table>
                <thead><tr><th>File</th><th>Format</th><th>Dimensions</th><th>How measured</th><th>Bytes</th><th>Found via</th><th>Source URL</th></tr></thead>
                <tbody>${fileRows}</tbody>
            </table></div>
            <h2>Link tags found</h2>
            <div style="overflow-x:auto"><table>
                <thead><tr><th>rel</th><th>sizes</th><th>type</th><th>href</th></tr></thead>
                <tbody>${linkRows}</tbody>
            </table></div>
            ${manifestRows}
            <h2>How this compares with a normal favicon set</h2>
            <p>A site you publish yourself usually needs a different set from the one ${esc(site.name)} happens to ship: 16×16, 32×32 and 48×48 in one <code>favicon.ico</code>, a 180×180 apple-touch icon, and 192×192 plus 512×512 manifest PNGs. That chart, including 96×96, maskable icons, Windows tiles and SVG, is the <a href="/blog/favicon-sizes-guide.html">favicon dimensions</a> guide. Use ${esc(site.name)}’s files as a reference, then build your own with the <a href="/blog/png-to-favicon.html">PNG to favicon converter</a>.</p>
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
    const title = 'Site Favicons: Amazon, YouTube, Google and More (Real Files)';
    const description = 'Real favicon files from popular websites, fetched and measured. Download the ico or png each site actually published. Icons belong to their owners.';
    const cards = sites.map((site) => {
        const preview = site.files.find((file) => file.format === 'png' || file.format === 'svg' || file.format === 'webp' || file.format === 'jpeg' || file.format === 'ico');
        const summary = site.files.slice(0, 3).map((file) => sizeText(file) + ' ' + file.format).join(' · ');
        return '<a href="/favicon/' + site.slug + '" class="block bg-white border border-gray-200 rounded-2xl p-5 hover:border-blue-300">'
            + (preview ? '<img src="/favicon/' + site.slug + '/' + preview.file + '" alt="' + esc(site.name) + ' favicon" width="48" height="48" style="width:48px;height:48px">' : '')
            + '<h2 class="text-xl font-semibold text-gray-900 mt-3">' + esc(site.name) + ' favicon.ico</h2>'
            + '<p class="text-sm text-gray-500 mt-1">' + esc(site.host) + '</p>'
            + '<p class="text-sm text-gray-600 mt-2">' + esc(summary) + '</p></a>';
    }).join('\n');
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
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900">Real favicons from popular websites</h1>
            <p class="text-gray-600 mt-4">Each page stores favicon files downloaded from that site on ${esc(FETCHED_LABEL)}, including the pixel size read from the file and the URL it came from. Icons belong to their owners and are shown for reference. A site that did not return an image is not listed.</p>
            <p class="text-gray-600 mt-3">For any other domain, use the <a href="/" class="text-blue-600 hover:underline">favicon downloader</a>. The size chart for files you publish yourself is the <a href="/blog/favicon-sizes-guide.html" class="text-blue-600 hover:underline">favicon dimensions</a> guide.</p>
        </header>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">${cards}</div>
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

function updateSitemap(locs) {
    let xml = fs.readFileSync(SITEMAP, 'utf8');
    const block = [
        '  <!-- site-favicons:start -->',
        ...locs.map((loc) => `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${FETCHED}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`),
        '  <!-- site-favicons:end -->'
    ].join('\n');
    if (xml.includes('<!-- site-favicons:start -->')) {
        xml = xml.replace(/  <!-- site-favicons:start -->[\s\S]*?  <!-- site-favicons:end -->/, block);
    } else {
        xml = xml.replace('</urlset>', block + '\n</urlset>');
    }
    fs.writeFileSync(SITEMAP, xml);
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

async function main() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    const results = await pool(SITES, 4, async (site) => {
        process.stdout.write('fetch ' + site.slug + '\n');
        try {
            return await collect(site);
        } catch (error) {
            return { slug: site.slug, name: site.name, error: error.message || String(error) };
        }
    });
    const ok = [];
    const omitted = [];
    for (const result of results) {
        if (!result || result.error || !result.files || !result.files.length) {
            omitted.push({ slug: result && result.slug, name: result && result.name, reason: (result && result.error) || 'no files', htmlStatus: result && result.htmlStatus, htmlUrl: result && result.htmlUrl });
            console.log('omit ' + (result && result.slug) + ': ' + (result && result.error));
            continue;
        }
        const files = writeFiles(result);
        const site = { ...result, files };
        fs.writeFileSync(path.join(OUT, site.slug, 'index.html'), renderPage(site));
        ok.push(site);
        console.log('kept ' + site.slug + ' (' + files.length + ' files)');
    }
    ok.sort((a, b) => a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(OUT, 'index.html'), renderIndex(ok));
    const publicSites = ok.map((site) => {
        const copy = { ...site };
        delete copy.about;
        return copy;
    });
    fs.writeFileSync(path.join(OUT, 'sites.json'), JSON.stringify({ fetched: FETCHED, sites: publicSites }, null, 2));
    fs.writeFileSync(path.join(OUT, 'omitted.json'), JSON.stringify({ fetched: FETCHED, omitted }, null, 2));
    updateSitemap(['https://favicondl.com/favicon/', ...ok.map((site) => 'https://favicondl.com/favicon/' + site.slug)]);
    console.log('pages ' + ok.length + ', omitted ' + omitted.length);
    if (!ok.length) process.exit(1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

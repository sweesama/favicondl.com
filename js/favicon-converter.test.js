'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const converter = require('./favicon-converter.js');

function crc32(bytes) {
    return converter.crc32(bytes);
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}

function solidPng(size, rgba) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
        row[1 + x * 4] = rgba[0];
        row[2 + x * 4] = rgba[1];
        row[3 + x * 4] = rgba[2];
        row[4 + x * 4] = rgba[3];
    }
    const raw = Buffer.alloc(row.length * size);
    for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function readZip(bytes) {
    const files = [];
    let offset = 0;
    while (offset + 30 <= bytes.length) {
        if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
        const method = bytes.readUInt16LE(offset + 8);
        const crc = bytes.readUInt32LE(offset + 14);
        const size = bytes.readUInt32LE(offset + 18);
        const nameLen = bytes.readUInt16LE(offset + 26);
        const extraLen = bytes.readUInt16LE(offset + 28);
        const name = bytes.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
        const start = offset + 30 + nameLen + extraLen;
        const data = bytes.slice(start, start + size);
        assert.equal(method, 0, name + ' should be stored, not compressed');
        assert.equal(converter.crc32(data), crc);
        files.push({ name, data });
        offset = start + size;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    return files;
}

test('multi-size ICO stores PNG payloads at 16, 32 and 48', () => {
    const entries = [16, 32, 48].map((size, i) => ({
        size,
        png: solidPng(size, [20 + i, 40, 60, 255])
    }));
    const ico = Buffer.from(converter.buildIco(entries));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    const images = converter.parseIco(ico);
    assert.deepEqual(images.map((img) => img.dirWidth), [16, 32, 48]);
    images.forEach((img) => {
        assert.equal(img.pngSize.width, img.dirWidth);
        assert.equal(img.pngSize.height, img.dirHeight);
    });
});

test('ZIP round-trips the favicon package names', () => {
    const png = solidPng(16, [1, 2, 3, 255]);
    const files = [
        { name: 'favicon.ico', data: converter.buildIco([{ size: 16, png }]) },
        { name: 'favicon-16x16.png', data: png },
        { name: 'site.webmanifest', data: Buffer.from(converter.manifestJson()) },
        { name: 'favicon-links.html', data: Buffer.from(converter.htmlSnippet()) }
    ];
    const zip = Buffer.from(converter.buildZip(files));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const unpacked = readZip(zip);
    assert.deepEqual(unpacked.map((file) => file.name), files.map((file) => file.name));
    unpacked.forEach((file, i) => {
        assert.deepEqual(file.data, Buffer.from(files[i].data));
    });
    const html = converter.htmlSnippet();
    assert.match(html, /favicon\.ico/);
    assert.match(html, /apple-touch-icon/);
    assert.match(html, /32x32/);
    assert.match(converter.manifestJson(), /192x192/);
    assert.match(converter.manifestJson(), /512x512/);
});

function assertRejects(svg, pattern) {
    assert.throws(() => converter.prepareSvg(svg), pattern);
}

test('prepareSvg caps a viewBox-only icon and keeps local fragments', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/></svg>';
    const out = converter.prepareSvg(svg);
    assert.match(out, /<svg width="512" height="512" viewBox="0 0 10 10"/);
    assert.match(out, /fill="url\(#g\)"/);
    assert.match(out, /href="#g"/);
    assert.doesNotMatch(out, /<script/i);
});

test('prepareSvg uses width and height when viewBox is missing, and preserves a wide ratio', () => {
    const sized = converter.prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#f0f"/></svg>');
    assert.match(sized, /width="512" height="256" viewBox="0 0 80 40"/);
    const wide = converter.prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20"><rect width="100" height="20" fill="#0f0"/></svg>');
    assert.match(wide, /width="512" height="102" viewBox="0 0 100 20"/);
    const titled = converter.prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><title>A &amp; B</title><rect width="8" height="8" fill="#00f"/></svg>');
    assert.match(titled, /A &amp; B/);
    assert.match(titled, /width="512" height="512"/);
});

test('prepareSvg rejects active, external, and oversized SVG', () => {
    const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
    const close = '</svg>';
    assertRejects(open + '<script>window.__pwned=true</script>' + close, /script/i);
    assertRejects('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=true"></svg>', /event handler/i);
    assertRejects(open + '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"></body></foreignObject>' + close, /foreignobject/i);
    assertRejects(open + '<image href="https://evil.example/x.png"/>' + close, /image/i);
    assertRejects(open + '<image href="data:image/png;base64,aaaa"/>' + close, /image|data/i);
    assertRejects('<!DOCTYPE svg [<!ENTITY xxe SYSTEM "http://evil.example/x">]><svg>&xxe;</svg>', /DOCTYPE|entities/i);
    assertRejects(open + '<style>@import url(https://evil.example/a.css);</style>' + close, /CSS|External/i);
    assertRejects(open + '<rect style="fill:url(https://evil.example/a)"/>' + close, /External CSS|image URLs/i);
    assertRejects('<?xml-stylesheet type="text/css" href="https://evil.example/a.css"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', /processing instruction/i);
    assertRejects(open + '<a href="https://evil.example/">x</a>' + close, /External links/i);
    assertRejects(open + '<use href="https://evil.example/icon.svg#a"/>' + close, /External links/i);
    assertRejects(open + '<rect fill="&#106;avascript:alert(1)"/>' + close, /Script and data URLs/i);
    assertRejects(open + '&#60;script&#62;alert(1)&#60;/script&#62;' + close, /script/i);
    assertRejects(open + '<rect href="&#104;ttps://evil.example/a.png"/>' + close, /External links/i);
    assertRejects('<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000"></svg>', /8192/);
    assertRejects('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9999999 10"></svg>', /viewBox is too large/);
    assertRejects('<html><body>nope</body></html>', /not an SVG/);
    assertRejects(open + '&nbsp;' + close, /entities/i);
    assertRejects('<?xml version="1.0" encoding="UTF-7"?><svg xmlns="http://www.w3.org/2000/svg"></svg>', /UTF-8/);
    assertRejects(open + ' '.repeat(converter.SVG_MAX_BYTES) + close, /1 MB/);
    assertRejects(open + '<g></g>'.repeat(5001) + close, /too many elements/);
    const safe = converter.prepareSvg(open + '<rect width="10" height="10" fill="#111"/>' + close);
    assert.equal(safe.includes('__pwned'), false);
    assert.doesNotMatch(safe, /<script/i);
});

test('the SVG to favicon page is a real tool route, not an article rewrite', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'svg-to-favicon.html'), 'utf8');
    assert.match(html, /<title>SVG to Favicon Generator \| favicondl<\/title>/);
    assert.match(html, /<h1[^>]*>\s*SVG to Favicon Generator\s*<\/h1>/);
    assert.match(html, /rel="canonical" href="https:\/\/favicondl.com\/svg-to-favicon"/);
    assert.match(html, /data-accept="svg"/);
    assert.match(html, /\/js\/favicon-converter\.js/);
    assert.match(html, /favicon\.ico/);
    assert.match(html, /16×16, 32×32 and 48×48/);
    assert.match(html, /does not include a <code>favicon\.svg<\/code>/);
    assert.doesNotMatch(html, /innerHTML\s*=/);
    const untouched = ['blog/svg-to-ico.html', 'blog/svg-favicon.html', 'blog/favicon-sizes-guide.html', 'blog/favicon-best-size-2026.html'];
    for (const file of untouched) {
        const body = fs.readFileSync(path.join(root, file), 'utf8');
        assert.equal(body.includes('/svg-to-favicon'), false, file);
    }
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const json = JSON.parse(blocks.map((match) => match[1]).find((block) => block.includes('FAQPage')));
    assert.equal(json.mainEntity.length, 5);
    for (const entity of json.mainEntity) {
        assert.ok(entity.acceptedAnswer.text.length > 40);
        assert.match(html, new RegExp(entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
    assert.equal(sitemap.split('https://favicondl.com/svg-to-favicon</loc>').length - 1, 1);
    const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    assert.ok(vercel.redirects.some((rule) => rule.source === '/svg-to-favicon.html' && rule.destination === '/svg-to-favicon' && rule.permanent === true));
    assert.ok(vercel.redirects.some((rule) => rule.source === '/svg-to-favicon/' && rule.destination === '/svg-to-favicon' && rule.permanent === true));
    assert.ok(vercel.rewrites.some((rule) => rule.source === '/svg-to-favicon' && rule.destination === '/svg-to-favicon.html'));
    const tools = fs.readFileSync(path.join(root, 'tools.html'), 'utf8');
    assert.match(tools, /data-i18n-only="en"[^>]*>[\s\S]*href="\/svg-to-favicon"/);
    assert.match(fs.readFileSync(path.join(root, 'favicon-checker.html'), 'utf8'), /href="\/svg-to-favicon"/);
});

test('accepted types are PNG, JPG, SVG and WebP only', () => {
    assert.equal(converter.isAccepted({ name: 'a.PNG', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.jpeg', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.svg', type: 'image/svg+xml' }), true);
    assert.equal(converter.isAccepted({ name: 'a.webp', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.gif', type: 'image/gif' }), false);
    assert.equal(converter.isAccepted({ name: 'a.txt', type: 'text/plain' }), false);
});

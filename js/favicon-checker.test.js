'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { canonicalApiPath } = require('../api/_lib/canonical');
const checker = require('./favicon-checker.js');

const ROOT = path.join(__dirname, '..');

test('extract requests use the canonical url and format only', () => {
    const inputs = [
        'github.com',
        'https://github.com',
        'https://github.com/',
        'HTTPS://WWW.GitHub.com/',
        'http://www.github.com',
        'https://github.com/docs/',
        '//cdn.example.com',
        'https://www.example.com:8443/a/b/?q=1'
    ];
    for (const input of inputs) {
        const requestPath = checker.canonicalExtractPath(input);
        assert.ok(requestPath, input);
        assert.match(requestPath, /^\/api\/extract\?url=[^&]+&format=json$/);
        assert.equal(requestPath.includes('size='), false, input);
        assert.equal(requestPath.includes('domain='), false, input);
        const canonical = canonicalApiPath(requestPath);
        assert.equal(canonical.error, null, input);
        assert.equal(canonical.path, requestPath, input);
        const messy = canonicalApiPath('/api/extract?url=' + encodeURIComponent(input) + '&format=json&zz=1&v=2');
        assert.equal(messy.path, requestPath, input);
    }
    assert.equal(checker.canonicalExtractPath('https://www.GitHub.com/'), '/api/extract?url=github.com&format=json');
    assert.equal(checker.canonicalExtractPath('not a url'), null);
    assert.equal(checker.canonicalExtractPath('javascript:alert(1)'), null);
    assert.equal(checker.canonicalExtractPath(''), null);
    assert.equal(checker.failureReason('http://127.0.0.1/admin'), 'blocked');
    assert.equal(checker.failureReason('10.1.2.3'), 'blocked');
    assert.equal(checker.canonicalExtractPath('http://192.168.0.5'), null);
});

test('ICO directory sizes include BMP layers and PNG-compressed entries', () => {
    const count = 2;
    const bytes = new Uint8Array(6 + count * 16 + 8);
    const view = new DataView(bytes.buffer);
    view.setUint16(2, 1, true);
    view.setUint16(4, count, true);
    bytes[6] = 16;
    bytes[7] = 16;
    view.setUint32(6 + 8, 4, true);
    view.setUint32(6 + 12, 6 + count * 16, true);
    bytes[22] = 0;
    bytes[23] = 0;
    view.setUint32(22 + 8, 4, true);
    view.setUint32(22 + 12, 6 + count * 16, true);
    const sizes = checker.readIcoSizes(bytes);
    assert.deepEqual(sizes, [
        { width: 16, height: 16 },
        { width: 256, height: 256 }
    ]);
    assert.deepEqual(checker.readIcoSizes(new Uint8Array([0, 0, 1, 0])), []);
});

test('a site icon set fills the checklist and ignores aggregator pixels', () => {
    const report = checker.analyze({
        ok: true,
        domain: 'github.com',
        source: 'html',
        format: 'svg',
        vector: true,
        rel: 'icon',
        width: null,
        height: null,
        iconUrl: 'https://github.githubassets.com/favicons/favicon.svg',
        proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.githubassets.com%2Ffavicons%2Ffavicon.svg',
        pageUrl: 'https://github.com/',
        candidates: [
            {
                url: 'https://github.githubassets.com/favicons/favicon.svg',
                proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.githubassets.com%2Ffavicons%2Ffavicon.svg',
                format: 'svg',
                vector: true,
                rel: 'icon',
                source: 'html',
                width: null,
                height: null
            },
            {
                url: 'https://github.githubassets.com/assets/app-icon-512.png',
                format: 'png',
                width: 512,
                height: 512,
                rel: 'manifest',
                source: 'manifest'
            },
            {
                url: 'https://github.githubassets.com/assets/app-icon-192.png',
                format: 'png',
                width: 192,
                height: 192,
                rel: 'manifest',
                source: 'manifest'
            },
            {
                url: 'https://github.githubassets.com/assets/apple-touch-icon-180.png',
                format: 'png',
                width: 180,
                height: 180,
                rel: 'manifest',
                source: 'manifest'
            },
            {
                url: 'https://github.com/favicon.ico',
                proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico&zz=1',
                format: 'ico',
                width: 32,
                height: 32,
                rel: 'favicon.ico',
                source: 'direct'
            }
        ]
    }, {
        icoSizes: {
            'https://github.com/favicon.ico': [
                { width: 16, height: 16 },
                { width: 32, height: 32 }
            ]
        }
    });

    const byId = Object.fromEntries(report.checks.map((item) => [item.id, item]));
    assert.deepEqual(report.checks.map((item) => item.id), checker.CHECK_IDS);
    assert.equal(byId.ico.status, 'present');
    assert.equal(byId.png16.status, 'present');
    assert.equal(byId.png32.status, 'present');
    assert.equal(byId.png48.status, 'missing');
    assert.match(byId.png48.snippet, /favicon-48x48\.png/);
    assert.match(byId.png48.detail, /no 48×48 layer/);
    assert.equal(byId.apple.status, 'present');
    assert.equal(byId.manifest.status, 'present');
    assert.equal(byId.png192.status, 'present');
    assert.equal(byId.png512.status, 'present');
    assert.equal(byId.svg.status, 'present');
    assert.equal(report.fixHtml.includes('favicon-32x32.png'), false);
    assert.match(report.fixHtml, /favicon-48x48\.png/);
    assert.equal(report.fallback, false);
    assert.equal(report.icons.find((icon) => icon.format === 'ico').sizeLabel, '16×16, 32×32');
    assert.equal(checker.proxyPath('https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico&zz=1'), null);
    assert.equal(
        checker.proxyPath('https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico'),
        '/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico'
    );
});

test('fallback images and mask icons do not satisfy the checklist', () => {
    const fallback = checker.analyze({
        ok: true,
        domain: 'example.com',
        source: 'google_s2',
        format: 'png',
        width: 128,
        height: 128,
        rel: null,
        iconUrl: 'https://www.google.com/s2/favicons?domain=example.com&sz=128',
        candidates: []
    });
    assert.equal(fallback.fallback, true);
    assert.equal(fallback.presentCount, 0);
    assert.equal(fallback.checks.every((item) => item.status === 'missing' && item.snippet), true);
    assert.equal(fallback.icons.length, 1);
    assert.match(fallback.fixManifest, /192x192/);
    assert.match(fallback.fixManifest, /512x512/);

    const mask = checker.analyze({
        ok: true,
        domain: 'example.com',
        source: 'html',
        format: 'svg',
        vector: true,
        rel: 'mask-icon',
        iconUrl: 'https://example.com/mask.svg',
        candidates: [{
            url: 'https://example.com/mask.svg',
            format: 'svg',
            vector: true,
            rel: 'mask-icon',
            source: 'html',
            width: null,
            height: null
        }]
    });
    assert.equal(mask.checks.find((item) => item.id === 'svg').status, 'missing');
    assert.match(mask.checks.find((item) => item.id === 'svg').snippet, /image\/svg\+xml/);
});

test('an apple-touch file at the wrong size asks for 180', () => {
    const report = checker.analyze({
        ok: true,
        domain: 'example.com',
        source: 'html',
        iconUrl: 'https://example.com/apple-touch-icon.png',
        format: 'png',
        width: 120,
        height: 120,
        rel: 'apple-touch-icon',
        candidates: [{
            url: 'https://example.com/apple-touch-icon.png',
            format: 'png',
            width: 120,
            height: 120,
            rel: 'apple-touch-icon',
            source: 'html'
        }]
    });
    const apple = report.checks.find((item) => item.id === 'apple');
    assert.equal(apple.status, 'partial');
    assert.match(apple.snippet, /180x180/);
    assert.match(apple.links.map((link) => link.href).join(' '), /apple-touch-icon-guide\.html/);
});

test('ICO bytes fetched through the proxy fill the smaller layers', async () => {
    const ico = new Uint8Array(6 + 16 + 4);
    const view = new DataView(ico.buffer);
    view.setUint16(2, 1, true);
    view.setUint16(4, 1, true);
    ico[6] = 16;
    ico[7] = 16;
    view.setUint32(14, 4, true);
    view.setUint32(18, 22, true);
    const data = {
        ok: true,
        candidates: [{
            url: 'https://example.com/favicon.ico',
            proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fexample.com%2Ffavicon.ico',
            format: 'ico',
            width: 48,
            height: 48,
            rel: 'favicon.ico',
            source: 'direct'
        }]
    };
    const embedded = await checker.loadIcoSizes(data, async function () {
        return { ok: true, arrayBuffer: async function () { return ico.buffer; } };
    });
    const report = checker.analyze(data, { icoSizes: embedded });
    assert.equal(report.checks.find((item) => item.id === 'png16').status, 'present');
    assert.equal(report.checks.find((item) => item.id === 'png48').status, 'missing');
});

test('the checker page, sitemap and routing stay canonical without new middleware', () => {
    const html = fs.readFileSync(path.join(ROOT, 'favicon-checker.html'), 'utf8');
    assert.match(html, /<title>[^<]*Favicon Checker[^<]*<\/title>/);
    assert.match(html, /<h1[^>]*>\s*Favicon Checker\s*<\/h1>/);
    assert.match(html, /rel="canonical" href="https:\/\/favicondl.com\/favicon-checker"/);
    assert.match(html, /"@type": "FAQPage"/);
    assert.match(html, /\/js\/favicon-checker\.js/);
    assert.match(html, /\/bulk-favicon-downloader\.html/);
    assert.match(html, /\/blog\/favicon-sizes-guide\.html/);
    assert.match(html, /\/favicon\//);
    assert.match(html, /\/tools\.html/);
    assert.match(html, /\/blog\/png-to-ico\.html/);

    const questions = [];
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const json = JSON.parse(blocks.map((match) => match[1]).find((block) => block.includes('FAQPage')));
    assert.equal(json['@type'], 'FAQPage');
    for (const entity of json.mainEntity) {
        questions.push(entity.name);
        assert.ok(entity.acceptedAnswer.text.length > 40);
        assert.match(html, new RegExp(entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.ok(questions.length >= 5);

    const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /<loc>https:\/\/favicondl.com\/favicon-checker<\/loc>/);
    const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    assert.ok(vercel.redirects.some((rule) => rule.source === '/favicon-checker.html' && rule.destination === '/favicon-checker' && rule.permanent === true));
    assert.ok(vercel.redirects.some((rule) => rule.source === '/favicon-checker/' && rule.destination === '/favicon-checker' && rule.permanent === true));
    assert.ok(vercel.rewrites.some((rule) => rule.source === '/favicon-checker' && rule.destination === '/favicon-checker.html'));
    const middleware = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    assert.match(middleware, /matcher:\s*\[[^\]]*['"]\/['"][^\]]*['"]\/index\.html['"]/);
    assert.equal(middleware.includes('favicon-checker'), false);

    const home = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(home, /href="\/favicon-checker"/);
    const guide = fs.readFileSync(path.join(ROOT, 'blog/favicon-sizes-guide.html'), 'utf8');
    assert.match(guide, /href="\/favicon-checker"/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pngSize, parseIco } = require('../js/favicon-converter.js');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'favicon/sites.json'), 'utf8'));

test('site favicon pages are real files with measured metadata', () => {
    assert.ok(data.sites.length >= 180, 'expected about 200 static pages, got ' + data.sites.length);
    const index = fs.readFileSync(path.join(ROOT, 'favicon/index.html'), 'utf8');
    assert.match(index, /belong to their owners/i);
    assert.match(index, /href="\/"/);
    assert.doesNotMatch(index, /\/api\/(extract|proxy|favicon)/);
    const titles = new Set();
    const summaries = new Set();
    for (const site of data.sites) {
        const htmlPath = path.join(ROOT, 'favicon', site.slug, 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        assert.match(html, new RegExp('href="https://favicondl.com/favicon/' + site.slug + '"'));
        assert.match(html, /belong to their owners/i);
        assert.match(html, /href="\/"/);
        assert.match(html, /favicon-best-size-2026\.html/);
        assert.doesNotMatch(html, /favicon-sizes-guide\.html/);
        assert.match(html, /FAQPage/);
        assert.equal(html.includes('/api/extract') || html.includes('/api/proxy') || html.includes('/api/favicon'), false, site.slug);
        assert.doesNotMatch(html, /fetch\(|XMLHttpRequest/);
        const title = html.match(/<title>([^<]+)<\/title>/)[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
        assert.equal(title, site.name + ' Favicon (favicon.ico) – Download & Sizes');
        assert.equal(titles.has(title), false, title);
        titles.add(title);
        assert.match(html, new RegExp('<time datetime="' + site.fetched + '">'));
        assert.ok(site.summary && site.summary.length > 80, site.slug);
        assert.equal(summaries.has(site.summary), false, site.slug);
        summaries.add(site.summary);
        assert.ok(Array.isArray(site.related) && site.related.length >= 5 && site.related.length <= 8, site.slug);
        for (const related of site.related) {
            assert.match(html, new RegExp('href="/favicon/' + related.slug + '"'));
            assert.match(index, new RegExp('href="/favicon/' + related.slug + '"'));
        }
        assert.match(index, new RegExp('href="/favicon/' + site.slug + '"'));
        if (site.faviconIcoUrl) assert.ok(html.includes(site.faviconIcoUrl), site.slug);
        if (site.appleTouchIconUrl) assert.ok(html.includes(site.appleTouchIconUrl), site.slug);
        if (site.brandColor) assert.ok(html.includes(site.brandColor.hex), site.slug);
        const visibleFaqs = [...html.matchAll(/<h3>(.*?)<\/h3><p>(.*?)<\/p>/g)].map((match) => [match[1], match[2]]);
        const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
        assert.equal(ld.mainEntity.length, visibleFaqs.length, site.slug);
        ld.mainEntity.forEach((entity, index) => {
            const question = visibleFaqs[index][0].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
            const answer = visibleFaqs[index][1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
            assert.equal(entity.name, question, site.slug);
            assert.equal(entity.acceptedAnswer.text, answer, site.slug);
            const yesNoQuestion = /^(May|Can|Is|Does|Do|Did)\b/.test(question);
            const yesNoAnswer = /^(Yes|No)\./.test(answer);
            assert.equal(yesNoAnswer, yesNoQuestion, site.slug + ' ' + question);
        });
        const icoFaq = ld.mainEntity.find((entity) => entity.name.indexOf('favicon.ico URL') !== -1);
        if (site.faviconIcoFormat === 'ico' && site.faviconIcoUrl) {
            assert.match(icoFaq.acceptedAnswer.text, new RegExp('^The favicon\\.ico is at ' + site.faviconIcoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            assert.match(icoFaq.acceptedAnswer.text, /directory sizes /);
        } else if (!site.faviconIcoUrl) {
            assert.match(icoFaq.acceptedAnswer.text, /^No favicon\.ico was published/);
        } else {
            assert.match(icoFaq.acceptedAnswer.text, /did not return an ICO container/);
        }
        const imgs = [...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
        assert.ok(imgs.length > 0, site.slug);
        for (const src of imgs) {
            assert.equal(src.startsWith('files/') || src.startsWith('/favicons/') || src.startsWith('/favicon/'), true, src);
        }
        assert.ok(site.files.length > 0, site.slug);
        for (const file of site.files) {
            const abs = path.join(ROOT, 'favicon', site.slug, file.file);
            const buf = fs.readFileSync(abs);
            assert.equal(buf.length, file.bytes, file.file);
            if (file.format === 'png') {
                const size = pngSize(buf);
                assert.equal(size.width, file.width, file.file);
                assert.equal(size.height, file.height, file.file);
            }
            if (file.format === 'ico') {
                const images = parseIco(buf);
                assert.ok(images.length > 0, file.file);
                assert.equal(images.length, file.icoImages.length);
            }
            assert.match(html, new RegExp(file.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
    }
});

test('sitemap lists the favicon index and each kept site once', () => {
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    assert.equal(xml.split('https://favicondl.com/favicon/</loc>').length - 1, 1);
    for (const site of data.sites) {
        const loc = 'https://favicondl.com/favicon/' + site.slug + '</loc>';
        assert.equal(xml.split(loc).length - 1, 1, site.slug);
        assert.match(xml, new RegExp('<loc>https://favicondl.com/favicon/' + site.slug + '</loc>\\s*<lastmod>' + site.fetched + '</lastmod>'));
    }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pngSize, parseIco } = require('../js/favicon-converter.js');

const ROOT = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'favicon/sites.json'), 'utf8'));

test('site favicon pages are real files with measured metadata', () => {
    assert.ok(data.sites.length >= 1);
    const index = fs.readFileSync(path.join(ROOT, 'favicon/index.html'), 'utf8');
    assert.match(index, /belong to their owners/i);
    assert.match(index, /href="\/"/);
    for (const site of data.sites) {
        const htmlPath = path.join(ROOT, 'favicon', site.slug, 'index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');
        assert.match(html, new RegExp('href="https://favicondl.com/favicon/' + site.slug + '"'));
        assert.match(html, /belong to their owners/i);
        assert.match(html, /href="\/"/);
        assert.match(html, /favicon-sizes-guide\.html/);
        assert.match(html, /FAQPage/);
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
    }
});

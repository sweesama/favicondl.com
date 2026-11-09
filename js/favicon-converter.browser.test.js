'use strict';

/**
 * Headless Chrome check: canvas conversion of PNG, JPG, SVG and WebP,
 * plus the on-page control, must produce a real 16/32/48 ICO and the PNG sizes.
 *
 * Run: node js/favicon-converter.browser.test.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');

const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const converterPath = path.join(__dirname, 'favicon-converter.js');

async function main() {
    if (!fs.existsSync(CHROME)) {
        console.error('Chrome not found at ' + CHROME);
        process.exit(1);
    }
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
    } catch (error) {
        console.error('puppeteer-core is required for the headless converter test.');
        console.error(error && error.message);
        process.exit(1);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
    const htmlPath = path.join(dir, 'harness.html');
    const samplePath = path.join(dir, 'sample.png');
    const textPath = path.join(dir, 'note.txt');
    fs.writeFileSync(textPath, 'not an image');
    fs.writeFileSync(htmlPath, `<!DOCTYPE html>
<meta charset="utf-8">
<div class="fc-mount" id="favicon-converter" data-heading="PNG to Favicon Converter" data-lead="Browser test."></div>
<pre id="out"></pre>
<script src="${converterPath}"></script>
<script>
document.body.dataset.done = '0';
(async function () {
  const out = document.getElementById('out');
  try {
    const pngBlob = await new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0b6';
      ctx.fillRect(0, 0, 64, 32);
      c.toBlob(resolve, 'image/png');
    });
    const jpegBlob = await new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#c30';
      ctx.fillRect(0, 0, 40, 40);
      c.toBlob(resolve, 'image/jpeg', 0.92);
    });
    const webpBlob = await new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#14c';
      ctx.fillRect(0, 0, 24, 24);
      c.toBlob(resolve, 'image/webp', 0.9);
    });
    const svgBlob = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#111"/></svg>'], { type: 'image/svg+xml' });
    async function summarize(file) {
      const result = await FaviconConverter.convertFile(file);
      const images = FaviconConverter.parseIco(result.ico);
      const pngs = {};
      for (const size of FaviconConverter.PNG_SIZES) {
        const dim = FaviconConverter.pngSize(result.pngs.get(size));
        pngs[size] = dim;
      }
      return {
        ico: images.map((img) => ({ dir: img.dirWidth, png: img.pngSize })),
        pngs,
        zip: result.zip[0] === 0x50 && result.zip[1] === 0x4b,
        html: result.html.indexOf('apple-touch-icon') !== -1 && result.html.indexOf('favicon.ico') !== -1,
        manifest: result.manifest.indexOf('512x512') !== -1
      };
    }
    const report = {
      png: await summarize(new File([pngBlob], 'mark.png', { type: 'image/png' })),
      jpeg: await summarize(new File([jpegBlob], 'photo.jpg', { type: 'image/jpeg' })),
      svg: await summarize(new File([svgBlob], 'mark.svg', { type: 'image/svg+xml' })),
      webp: webpBlob ? await summarize(new File([webpBlob], 'mark.webp', { type: 'image/webp' })) : null
    };
    window.__report = report;
    out.textContent = JSON.stringify(report);
    document.body.dataset.done = '1';
  } catch (error) {
    out.textContent = JSON.stringify({ error: String(error && error.stack || error) });
    document.body.dataset.done = 'error';
  }
})();
</script>`);

    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    try {
        const page = await browser.newPage();
        page.on('pageerror', (error) => console.error('pageerror', error));
        await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => document.body.dataset.done === '1' || document.body.dataset.done === 'error', { timeout: 30000 });
        const report = await page.evaluate(() => JSON.parse(document.getElementById('out').textContent));
        if (report.error) throw new Error(report.error);
        for (const kind of ['png', 'jpeg', 'svg', 'webp']) {
            const item = report[kind];
            assert.ok(item, kind + ' missing');
            assert.deepStrictEqual(item.ico.map((img) => img.dir), [16, 32, 48], kind + ' ico sizes');
            item.ico.forEach((img) => {
                assert.strictEqual(img.png.width, img.dir, kind + ' png width');
                assert.strictEqual(img.png.height, img.dir, kind + ' png height');
            });
            for (const size of [16, 32, 48, 180, 192, 512]) {
                assert.strictEqual(item.pngs[size].width, size, kind + ' ' + size);
                assert.strictEqual(item.pngs[size].height, size, kind + ' ' + size);
            }
            assert.strictEqual(item.zip, true, kind + ' zip');
            assert.strictEqual(item.html, true, kind + ' html');
            assert.strictEqual(item.manifest, true, kind + ' manifest');
        }

        const pngBytes = await page.evaluate(async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 8;
            canvas.height = 8;
            canvas.getContext('2d').fillRect(0, 0, 8, 8);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            return Array.from(new Uint8Array(await blob.arrayBuffer()));
        });
        fs.writeFileSync(samplePath, Buffer.from(pngBytes));
        const input = await page.$('#favicon-converter input[type=file]');
        await input.uploadFile(samplePath);
        await page.waitForFunction(() => document.getElementById('favicon-converter').dataset.fcStatus === 'ready', { timeout: 20000 });
        const ui = await page.evaluate(() => {
            const root = document.getElementById('favicon-converter');
            const imgs = Array.from(root.querySelectorAll('.fc-previews img'));
            return {
                status: root.dataset.fcStatus,
                snippet: root.querySelector('.fc-code').textContent,
                widths: imgs.map((img) => img.naturalWidth),
                alts: imgs.map((img) => img.alt)
            };
        });
        assert.strictEqual(ui.status, 'ready');
        assert.ok(ui.snippet.includes('rel="icon"'));
        assert.ok(ui.snippet.includes('192x192'));
        assert.deepStrictEqual(ui.widths, [16, 32, 48, 180]);

        const bad = await page.$('#favicon-converter input[type=file]');
        await bad.uploadFile(textPath);
        await page.waitForFunction(() => document.getElementById('favicon-converter').dataset.fcStatus === 'error', { timeout: 10000 });

        const rootDir = path.join(__dirname, '..');
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://127.0.0.1');
            let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
            if (rel.endsWith('/')) rel += 'index.html';
            const filePath = path.normalize(path.join(rootDir, rel));
            if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
                res.statusCode = 404;
                res.end('not found');
                return;
            }
            res.end(fs.readFileSync(filePath));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        try {
            const live = await browser.newPage();
            await live.goto('http://127.0.0.1:' + port + '/blog/png-to-favicon.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await live.waitForFunction(() => {
                const h2 = document.querySelector('#favicon-converter h2');
                return h2 && h2.textContent.indexOf('PNG to Favicon') !== -1;
            }, { timeout: 15000 });
            const title = await live.title();
            assert.ok(title.startsWith('PNG to Favicon Converter'), title);
            const inputLive = await live.$('#favicon-converter input[type=file]');
            await inputLive.uploadFile(samplePath);
            await live.waitForFunction(() => document.getElementById('favicon-converter').dataset.fcStatus === 'ready', { timeout: 20000 });
            const liveUi = await live.evaluate(() => document.querySelector('#favicon-converter .fc-code').textContent);
            assert.ok(liveUi.includes('favicon.ico'));
            assert.ok(liveUi.includes('512x512'));
            const dims = await live.goto('http://127.0.0.1:' + port + '/blog/favicon-sizes-guide.html', { waitUntil: 'domcontentloaded' });
            assert.strictEqual(dims.status(), 200);
            const h1 = await live.$eval('h1', (el) => el.textContent);
            assert.ok(h1.startsWith('Favicon Dimensions'), h1);
            const site = await live.goto('http://127.0.0.1:' + port + '/favicon/amazon/', { waitUntil: 'domcontentloaded' });
            assert.strictEqual(site.status(), 200);
            const amazon = await live.evaluate(() => ({
                h1: document.querySelector('h1').textContent,
                trademark: document.body.innerText.includes('belong to their owners'),
                download: !!document.querySelector('a[download]')
            }));
            assert.ok(amazon.h1.includes('Amazon'));
            assert.strictEqual(amazon.trademark, true);
            assert.strictEqual(amazon.download, true);
        } finally {
            server.close();
        }
        console.log('Headless converter test passed for PNG, JPG, SVG and WebP, including the PNG page.');
    } finally {
        await browser.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

'use strict';

/**
 * Headless Chrome: /svg-to-favicon rasterizes real SVG files to ICO and PNG
 * bytes, rejects active SVG, and does not fetch or execute the upload.
 *
 * Run: node js/svg-to-favicon.browser.test.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const assert = require('assert');
const converter = require('./favicon-converter.js');

const CHROME = process.env.CHROME_PATH || '/usr/local/bin/google-chrome';
const ROOT = path.join(__dirname, '..');
const ARTIFACTS = process.env.SVG_FAVICON_ARTIFACTS || '/opt/cursor/artifacts';

function pageHtml() {
    return `<!DOCTYPE html><meta charset="utf-8"><title>harness</title><div id="svg-to-favicon" class="fc-mount" data-accept="svg" data-heading="Generate favicon files" data-lead="Browser test."></div><script src="/js/favicon-converter.js"></script>`;
}

function startServer() {
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname === '/should-not-load.png' || url.pathname === '/should-not-load.svg') {
            res.statusCode = 200;
            res.end('leaked');
            return;
        }
        let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        if (rel === 'svg-to-favicon') rel = 'svg-to-favicon.html';
        if (rel.endsWith('/')) rel += 'index.html';
        const filePath = path.normalize(path.join(ROOT, rel));
        if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.statusCode = 404;
            res.end('not found');
            return;
        }
        res.end(fs.readFileSync(filePath));
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function write(dir, name, text) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
}

async function upload(page, filePath, status) {
    const input = await page.$('#svg-to-favicon input[type=file]');
    await input.uploadFile(filePath);
    await page.waitForFunction((expected) => document.getElementById('svg-to-favicon').dataset.fcStatus === expected, { timeout: 20000 }, status);
}

async function summarize(page) {
    return page.evaluate(async () => {
        const root = document.getElementById('svg-to-favicon');
        const result = root.__fcResult;
        async function pixels(bytes) {
            const blob = new Blob([bytes], { type: 'image/png' });
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(bitmap, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            const at = (x, y) => {
                const i = (y * canvas.width + x) * 4;
                return [data[i], data[i + 1], data[i + 2], data[i + 3]];
            };
            return {
                width: canvas.width,
                height: canvas.height,
                corner: at(0, 0),
                center: at(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)),
                top: at(Math.floor(canvas.width / 2), 0)
            };
        }
        const pngs = {};
        for (const size of FaviconConverter.PNG_SIZES) {
            const bytes = result.pngs.get(size);
            const dim = FaviconConverter.pngSize(bytes);
            pngs[size] = { bytes: bytes.byteLength, width: dim.width, height: dim.height, px: await pixels(bytes) };
        }
        const previews = Array.from(root.querySelectorAll('.fc-previews img')).map((img) => ({
            src: img.src.slice(0, 5),
            width: img.naturalWidth,
            height: img.naturalHeight,
            alt: img.alt
        }));
        const names = Array.from(root.querySelectorAll('.fc-pngs button')).map((button) => button.textContent);
        return {
            status: root.dataset.fcStatus,
            message: root.querySelector('.fc-status').textContent,
            source: [result.sourceWidth, result.sourceHeight],
            icoBytes: result.ico.byteLength,
            zipBytes: result.zip.byteLength,
            ico: FaviconConverter.parseIco(result.ico).map((img) => ({
                dir: img.dirWidth,
                width: img.pngSize && img.pngSize.width,
                height: img.pngSize && img.pngSize.height,
                bytes: img.png.byteLength
            })),
            zipIsPk: result.zip[0] === 0x50 && result.zip[1] === 0x4b,
            pngs,
            previews,
            names,
            markup: root.innerHTML,
            objectCount: root.querySelectorAll('object, embed, svg, iframe').length
        };
    });
}

async function main() {
    if (!fs.existsSync(CHROME)) {
        console.error('Chrome not found at ' + CHROME);
        process.exit(1);
    }
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
    } catch (error) {
        console.error('puppeteer-core is required for the SVG favicon browser test.');
        console.error(error && error.message);
        process.exit(1);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-favicon-'));
    const downloads = path.join(dir, 'downloads');
    fs.mkdirSync(downloads);
    const red = write(dir, 'red.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#ff0000"/></svg>');
    const wide = write(dir, 'wide.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#00aa00"/></svg>');
    const circle = write(dir, 'circle.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="18" fill="#0000ff"/></svg>');
    let largeBody = '';
    for (let i = 0; i < 800; i++) {
        largeBody += '<rect x="' + (i % 40) + '" y="' + ((i / 40) | 0) + '" width="1" height="1" fill="#123456"/>';
    }
    const large = write(dir, 'large.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' + largeBody + '</svg>');
    const hostile = [
        ['script.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=true"><script>window.__pwned=true</script><rect width="10" height="10" fill="red"/></svg>'],
        ['foreign.svg', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="http://127.0.0.1/should-not-load.png"></body></foreignObject></svg>'],
        ['remote-image.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="http://127.0.0.1/should-not-load.png" width="10" height="10"/></svg>'],
        ['entity.svg', '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "http://127.0.0.1/should-not-load.svg">]><svg xmlns="http://www.w3.org/2000/svg">&xxe;</svg>'],
        ['css.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" style="fill:url(http://127.0.0.1/should-not-load.png)"/></svg>'],
        ['encoded.svg', '<svg xmlns="http://www.w3.org/2000/svg">&#60;script&#62;window.__pwned=true&#60;/script&#62;</svg>'],
        ['plain.svg', 'this is not an svg'],
        ['broken.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#f00"'],
        ['huge.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><!--' + 'a'.repeat(1024 * 1024) + '--></svg>']
    ].map(([name, text]) => write(dir, name, text));

    const server = await startServer();
    const port = server.address().port;
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    const leaked = [];
    const alerts = [];
    try {
        const page = await browser.newPage();
        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
        page.on('dialog', (dialog) => {
            alerts.push(dialog.message());
            return dialog.dismiss();
        });
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('should-not-load') || url.includes('evil.example') || url.includes('__pwned')) leaked.push(url);
        });
        await page.evaluateOnNewDocument(() => { window.__pwned = false; });
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto('http://127.0.0.1:' + port + '/svg-to-favicon', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => {
            const heading = document.querySelector('#svg-to-favicon h2');
            return heading && heading.textContent === 'Generate favicon files';
        });
        const meta = await page.evaluate(() => ({
            title: document.title,
            h1: document.querySelector('h1').textContent.trim(),
            canonical: document.querySelector('link[rel="canonical"]').href,
            accept: document.querySelector('#svg-to-favicon input[type=file]').getAttribute('accept'),
            toolSvg: document.querySelectorAll('#svg-to-favicon svg, #svg-to-favicon object, #svg-to-favicon embed').length
        }));
        assert.strictEqual(meta.title, 'SVG to Favicon Generator | favicondl');
        assert.strictEqual(meta.h1, 'SVG to Favicon Generator');
        assert.ok(meta.canonical.endsWith('/svg-to-favicon'));
        assert.ok(meta.accept.includes('.svg'));
        assert.strictEqual(meta.toolSvg, 0);

        await page.click('#svg-sample');
        await page.waitForFunction(() => document.getElementById('svg-to-favicon').dataset.fcStatus === 'ready', { timeout: 20000 });

        await upload(page, red, 'ready');
        const square = await summarize(page);
        assert.strictEqual(square.objectCount, 0);
        assert.ok(!square.markup.includes('<svg'));
        assert.ok(!square.markup.includes('window.__pwned'));
        assert.deepStrictEqual(square.previews.map((img) => img.width), [16, 32, 48, 180]);
        square.previews.forEach((img) => {
            assert.strictEqual(img.src, 'blob:');
            assert.strictEqual(img.width, img.height);
        });
        assert.deepStrictEqual(square.ico.map((img) => img.dir), [16, 32, 48]);
        square.ico.forEach((img) => {
            assert.strictEqual(img.width, img.dir);
            assert.strictEqual(img.height, img.dir);
        });
        for (const size of [16, 32, 48, 180, 192, 512]) {
            assert.strictEqual(square.pngs[size].width, size);
            assert.strictEqual(square.pngs[size].height, size);
            assert.ok(square.pngs[size].bytes > 50);
            const center = square.pngs[size].px.center;
            assert.ok(center[0] > 240 && center[1] < 20 && center[2] < 20 && center[3] === 255, size + ' center ' + center);
        }
        assert.strictEqual(square.zipIsPk, true);
        assert.deepStrictEqual(square.names, [
            'favicon-16x16.png',
            'favicon-32x32.png',
            'favicon-48x48.png',
            'apple-touch-icon.png',
            'android-chrome-192x192.png',
            'android-chrome-512x512.png'
        ]);

        await page.click('[data-dl="ico"]');
        await page.click('[data-dl="zip"]');
        await page.evaluate(() => document.querySelector('.fc-pngs button').click());
        const icoPath = path.join(downloads, 'favicon.ico');
        const zipPath = path.join(downloads, 'favicon-package.zip');
        const pngPath = path.join(downloads, 'favicon-16x16.png');
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline && !(fs.existsSync(icoPath) && fs.existsSync(zipPath) && fs.existsSync(pngPath))) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const icoFile = fs.readFileSync(icoPath);
        const zipFile = fs.readFileSync(zipPath);
        const pngFile = fs.readFileSync(pngPath);
        assert.deepStrictEqual(converter.parseIco(icoFile).map((img) => img.dirWidth), [16, 32, 48]);
        converter.parseIco(icoFile).forEach((img) => {
            assert.strictEqual(img.pngSize.width, img.dirWidth);
            assert.strictEqual(img.pngSize.height, img.dirHeight);
            assert.strictEqual(img.png[0], 137);
            assert.strictEqual(img.png[1], 80);
        });
        assert.strictEqual(pngFile[0], 137);
        assert.strictEqual(pngFile[1], 80);
        assert.deepStrictEqual(converter.pngSize(pngFile), { width: 16, height: 16 });
        assert.strictEqual(zipFile.readUInt32LE(0), 0x04034b50);
        assert.ok(zipFile.includes(Buffer.from('favicon.ico')));
        assert.ok(zipFile.includes(Buffer.from('android-chrome-512x512.png')));
        assert.strictEqual(icoFile.length, square.icoBytes);
        assert.strictEqual(pngFile.length, square.pngs[16].bytes);

        await upload(page, wide, 'ready');
        const wideReport = await summarize(page);
        const widePx = wideReport.pngs[32].px;
        assert.strictEqual(widePx.top[3], 0, 'wide icon top pixel should be transparent, got ' + widePx.top);
        assert.ok(widePx.center[1] > 120 && widePx.center[3] === 255, 'wide icon center ' + widePx.center);
        assert.deepStrictEqual(wideReport.source[0] > wideReport.source[1], true);

        await upload(page, circle, 'ready');
        const circleReport = await summarize(page);
        assert.strictEqual(circleReport.pngs[32].px.corner[3], 0);
        assert.ok(circleReport.pngs[32].px.center[2] > 200 && circleReport.pngs[32].px.center[3] === 255);

        await upload(page, large, 'ready');
        const largeReport = await summarize(page);
        assert.strictEqual(largeReport.pngs[512].width, 512);
        assert.strictEqual(largeReport.ico.length, 3);
        assert.ok(fs.statSync(large).size > fs.statSync(red).size);

        if (fs.existsSync(ARTIFACTS)) {
            await page.screenshot({ path: path.join(ARTIFACTS, 'svg-to-favicon-desktop.png') });
        }

        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        await upload(page, red, 'ready');
        const mobile = await page.evaluate(() => {
            const pick = document.querySelector('#svg-to-favicon .fc-pick');
            const download = document.querySelector('#svg-to-favicon [data-dl="ico"]');
            download.scrollIntoView({ block: 'center' });
            const box = download.getBoundingClientRect();
            return {
                pickWidth: pick.getBoundingClientRect().width,
                downloadWidth: box.width,
                downloadHeight: box.height,
                status: document.getElementById('svg-to-favicon').dataset.fcStatus
            };
        });
        assert.strictEqual(mobile.status, 'ready');
        assert.ok(mobile.pickWidth > 40, 'choose button width ' + mobile.pickWidth);
        assert.ok(mobile.downloadWidth > 40 && mobile.downloadHeight > 20);
        if (fs.existsSync(ARTIFACTS)) {
            await page.screenshot({ path: path.join(ARTIFACTS, 'svg-to-favicon-mobile.png'), fullPage: false });
        }

        let attackRequests = [];
        const onAttack = (request) => attackRequests.push(request.url());
        page.on('request', onAttack);
        for (const filePath of hostile) {
            attackRequests = [];
            await upload(page, filePath, 'error');
            const state = await page.evaluate(() => ({
                pwned: window.__pwned,
                status: document.getElementById('svg-to-favicon').dataset.fcStatus,
                message: document.querySelector('#svg-to-favicon .fc-status').textContent,
                hidden: document.querySelector('#svg-to-favicon .fc-actions').hidden,
                result: document.getElementById('svg-to-favicon').__fcResult,
                injected: document.documentElement.innerHTML.includes('window.__pwned') || document.documentElement.innerHTML.includes('should-not-load')
            }));
            assert.strictEqual(state.pwned, false, filePath);
            assert.strictEqual(state.status, 'error', filePath + ' ' + state.message);
            assert.ok(state.message.length > 8, state.message);
            assert.strictEqual(state.hidden, true, filePath);
            assert.strictEqual(state.result, null, filePath);
            assert.strictEqual(state.injected, false, filePath);
            const external = attackRequests.filter((url) => !url.startsWith('blob:') && !url.startsWith('data:'));
            assert.deepStrictEqual(external, [], filePath + ' requested ' + external.join(','));
        }
        assert.deepStrictEqual(leaked, []);
        assert.deepStrictEqual(alerts, []);

        const report = {
            red16: { bytes: square.pngs[16].bytes, center: square.pngs[16].px.center, size: [square.pngs[16].width, square.pngs[16].height] },
            red512: { bytes: square.pngs[512].bytes, center: square.pngs[512].px.center },
            icoBytes: icoFile.length,
            zipBytes: zipFile.length,
            png16Bytes: pngFile.length,
            wide32: { cornerAlpha: widePx.top[3], center: widePx.center, source: wideReport.source },
            circle32: { corner: circleReport.pngs[32].px.corner, center: circleReport.pngs[32].px.center },
            largeSvgBytes: fs.statSync(large).size,
            large512Bytes: largeReport.pngs[512].bytes,
            hostile: hostile.length
        };
        fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
        console.log('SVG to favicon browser test passed.');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

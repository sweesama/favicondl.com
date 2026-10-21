const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = __dirname;
const analyticsSource = fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8');

function loadAnalytics(windowStub) {
    const sandbox = { window: windowStub };
    vm.runInNewContext(analyticsSource, sandbox, { filename: 'analytics.js' });
    return sandbox.window.favicondlTrack;
}

test('no-ops when gtag is missing, not a function, or throws', () => {
    const missing = { location: { pathname: '/' } };
    const trackMissing = loadAnalytics(missing);
    assert.equal(typeof trackMissing, 'function');
    assert.doesNotThrow(() => trackMissing('favicon_download', { tool: 'homepage' }));

    const calls = [];
    const throwing = {
        location: { pathname: '/' },
        gtag() {
            calls.push('called');
            throw new Error('blocked');
        },
    };
    assert.doesNotThrow(() => loadAnalytics(throwing)('favicon_download', { tool: 'homepage' }));
    assert.deepEqual(calls, ['called']);

    const notFn = { location: { pathname: '/' }, gtag: 'blocked' };
    assert.doesNotThrow(() => loadAnalytics(notFn)('copy_api', { snippet_type: 'example' }));
});

test('drops events when the site opt-out flag is set', () => {
    const calls = [];
    const track = loadAnalytics({
        location: { pathname: '/' },
        favicondlAnalyticsDisabled: true,
        gtag() { calls.push(arguments); },
    });
    track('favicon_download', { tool: 'homepage' });
    assert.equal(calls.length, 0);
});

test('rejects event names gtag would not accept', () => {
    const calls = [];
    const track = loadAnalytics({
        location: { pathname: '/' },
        gtag(_cmd, name) { calls.push(name); },
    });
    track('favicon download', {});
    track('123bad', {});
    track('', {});
    track('favicon_download', { tool: 'homepage' });
    assert.deepEqual(calls, ['favicon_download']);
});

test('adds page context and sanitizes parameters', () => {
    const cases = [
        ['/', 'homepage', 'en'],
        ['/index.html', 'homepage', 'en'],
        ['/zh/', 'homepage', 'zh'],
        ['/zh/index.html', 'homepage', 'zh'],
        ['/ja/tools.html', 'tools', 'ja'],
        ['/ko/bulk-favicon-downloader.html', 'bulk', 'ko'],
        ['/es/documentation.html', 'docs', 'es'],
        ['/blog/favicon-sizes-guide.html', 'other', 'en'],
        ['/zh/blog/favicon-sizes-guide.html', 'other', 'zh'],
    ];

    for (const [pathname, pageType, lang] of cases) {
        const calls = [];
        const track = loadAnalytics({
            location: { pathname },
            gtag(_cmd, name, params) { calls.push({ name, params }); },
        });
        track('favicon_download', {
            tool: 'homepage',
            download_type: 'single',
            file_format: 'png',
            icon_size: '32',
            file_count: 1,
            source_format: null,
            empty: '',
            'bad-key': 'nope',
            note: 'x'.repeat(150),
            flagged: false,
        });
        assert.equal(calls.length, 1, pathname);
        assert.equal(calls[0].name, 'favicon_download');
        const params = calls[0].params;
        assert.equal(params.page_type, pageType);
        assert.equal(params.page_lang, lang);
        assert.equal(params.tool, 'homepage');
        assert.equal(params.file_count, 1);
        assert.equal(params.note.length, 100);
        assert.equal(params.flagged, 'false');
        assert.equal(params.badkey, 'nope');
        assert.equal('source_format' in params, false);
        assert.equal('empty' in params, false);
        assert.equal('bad-key' in params, false);
    }
});

test('keeps a zero file_count and does not overwrite an explicit page_type', () => {
    const calls = [];
    const track = loadAnalytics({
        location: { pathname: '/tools.html' },
        gtag(_cmd, _name, params) { calls.push(params); },
    });
    track('favicon_download', { file_count: 0, page_type: 'custom' });
    assert.equal(calls[0].file_count, 0);
    assert.equal(calls[0].page_type, 'custom');
    assert.equal(calls[0].page_lang, 'en');
});

test('tool scripts record downloads only on the success paths', () => {
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const tools = fs.readFileSync(path.join(ROOT, 'tools.js'), 'utf8');

    assert.match(main, /trackHomepageDownload\(exportSize\)/);
    assert.match(main, /trackHomepageDownload\(targetSize\)/);
    assert.match(main, /event: 'copy_snippet'/);
    assert.match(main, /snippet_type: 'favicon_html'/);
    assert.match(main, /snippet_type: 'direct_url'/);
    assert.match(main, /typeof window\.favicondlTrack === 'function'/);

    for (const tool of ['homepage', 'generator', 'batch', 'converter']) {
        assert.equal(
            tools.includes(`tool: '${tool}'`) || main.includes(`tool: '${tool}'`),
            true,
            tool
        );
    }
    assert.match(tools, /tool: 'generator'/);
    assert.match(tools, /tool: 'batch'/);
    assert.match(tools, /tool: 'converter'/);
    assert.match(tools, /file_format: 'zip'/);
    assert.match(tools, /file_format: 'ico'/);
    assert.match(tools, /download_type: 'bulk'/);
    assert.match(tools, /download_type: 'single'/);
    // The browser-blocked batch fallback opens a tab and must not count.
    const batchIcon = tools.slice(tools.indexOf('async downloadBatchIcon'), tools.indexOf('async downloadBatchResults'));
    assert.equal(batchIcon.includes("window.open"), true);
    const fallback = batchIcon.slice(batchIcon.indexOf('} catch'));
    assert.equal(fallback.includes('favicon_download'), false);
});

test('pages that share the tools load the helper, and docs copy the API samples', () => {
    const pages = ['index.html', 'tools.html', 'bulk-favicon-downloader.html', 'documentation.html'];
    for (const page of pages) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
        assert.match(html, /src="\/analytics\.js\?v=[^"]+"/);
    }
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /main\.js\?v=/);
    assert.match(fs.readFileSync(path.join(ROOT, 'tools.html'), 'utf8'), /tools\.js\?v=/);
    assert.match(fs.readFileSync(path.join(ROOT, 'bulk-favicon-downloader.html'), 'utf8'), /\/tools\.js\?v=/);

    const docs = fs.readFileSync(path.join(ROOT, 'documentation.html'), 'utf8');
    assert.match(docs, /favicondlTrack\('copy_api'/);
    for (const id of ['success-response', 'error-response', 'js-example', 'python-example', 'php-example', 'html-example']) {
        assert.match(docs, new RegExp(`'${id}'`));
    }
    assert.match(docs, /snippet_language: 'javascript'/);
    assert.match(docs, /snippet_type: 'endpoint_url'/);
});

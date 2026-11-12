import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';

import { encodedStructureError, expectedAlternateUrl } from './validate-output.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run 43176903270: generation of fastapi favicon passed, then validate-output.js
// reported six encoded-structure errors. The samples below are the shape of
// that article: escaped structural tags inside <pre><code> and inline <code>.

const codeBody = `<p>Mount static files, then return HTML from the index route.</p>
<p>Put the icon link in <code>&lt;head&gt;</code>. The anchor in the sample is <code>&lt;a href='/static/favicon.ico'&gt;icon&lt;/a&gt;</code>.</p>
<pre><code>from fastapi.responses import HTMLResponse

@app.get('/', response_class=HTMLResponse)
def home():
    return """
&lt;h2&gt;FastAPI favicon&lt;/h2&gt;
&lt;p&gt;The icon is served from static/favicon.ico.&lt;/p&gt;
&lt;a href='/docs'&gt;API docs&lt;/a&gt;
&lt;code&gt;favicon.ico&lt;/code&gt;
&lt;ul&gt;&lt;li&gt;one&lt;/li&gt;&lt;/ul&gt;
&lt;thead&gt;&lt;tr&gt;&lt;td&gt;file&lt;/td&gt;&lt;/tr&gt;&lt;/thead&gt;
&lt;blockquote&gt;keep the URL stable&lt;/blockquote&gt;
"""</code></pre>
<p>Request /favicon.ico and expect image bytes rather than a 404.</p>`;

function englishSource(body, templates = '') {
  return `<!DOCTYPE html><html lang="en"><head><title>FastAPI</title></head><body><article>
<div class="article-body" data-lang="en">${body}</div>
${templates}
</article></body></html>`;
}

function visibleHtml(page) {
  const $ = load(page, { decodeEntities: false });
  return $('.article-body').first().html() || '';
}

test('spanish size queries use tamanos as the es alternate', () => {
  const tamanos = 'https://favicondl.com/es/tamanos-de-favicon.html';
  assert.equal(expectedAlternateUrl('favicon-best-size-2026', 'es'), tamanos);
  assert.equal(expectedAlternateUrl('favicon-sizes-guide', 'es'), tamanos);
  assert.equal(
    expectedAlternateUrl('favicon-best-size-2026', 'en'),
    'https://favicondl.com/blog/favicon-best-size-2026.html',
  );
  assert.equal(
    expectedAlternateUrl('favicon-best-size-2026', 'zh'),
    'https://favicondl.com/zh/blog/favicon-best-size-2026.html',
  );
  assert.equal(
    expectedAlternateUrl('png-to-ico', 'es'),
    'https://favicondl.com/es/blog/png-to-ico.html',
  );

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const english = fs.readFileSync(path.join(root, 'blog/favicon-best-size-2026.html'), 'utf8');
  const $ = load(english, { decodeEntities: false });
  assert.equal($('link[rel="alternate"][hreflang="es"]').attr('href'), tamanos);
  assert.equal($('link[rel="canonical"]').attr('href'), 'https://favicondl.com/blog/favicon-best-size-2026.html');
  const englishAlternates = $('link[rel="alternate"][hreflang="en"]').map((_, el) => $(el).attr('href')).get();
  assert.deepEqual(englishAlternates, ['https://favicondl.com/blog/favicon-best-size-2026.html']);

  const tamanosPage = fs.readFileSync(path.join(root, 'es/tamanos-de-favicon.html'), 'utf8');
  const tamanosDoc = load(tamanosPage, { decodeEntities: false });
  assert.equal(
    tamanosDoc('link[rel="alternate"][hreflang="en"]').attr('href'),
    'https://favicondl.com/blog/favicon-sizes-guide.html',
  );
  assert.equal(
    tamanosDoc('link[rel="alternate"][hreflang="x-default"]').attr('href'),
    'https://favicondl.com/blog/favicon-sizes-guide.html',
  );
  assert.equal(tamanosDoc('link[rel="alternate"][hreflang="en"]').length, 1);
});

test('escaped structural tags inside pre and inline code pass both output checks', () => {
  const templates = ['zh', 'ja', 'ko', 'es']
    .map((lang) => `<template data-article-lang="${lang}">${codeBody}</template>`)
    .join('\n');
  const source = englishSource(codeBody, templates);
  assert.equal(encodedStructureError(source, 'source'), '');
  assert.equal(encodedStructureError(visibleHtml(source), 'visible'), '');

  // patchEnglishPage and localizeArticlePage serialize through cheerio.
  const roundTrip = load(source, { decodeEntities: false }).html();
  assert.equal(encodedStructureError(roundTrip, 'source'), '');
  assert.equal(encodedStructureError(visibleHtml(roundTrip), 'visible'), '');

  const templateHtml = load(source, { decodeEntities: false })('template[data-article-lang="zh"]').html() || '';
  const localized = load(`<div class="article-body">${templateHtml}</div>`, { decodeEntities: false })
    .html();
  assert.equal(encodedStructureError(visibleHtml(localized), 'visible'), '');
});

test('escaped structural tags in prose still fail, including the English source scan', () => {
  const prose = '<p>The model wrote &lt;h2&gt;Next&lt;/h2&gt; and &lt;blockquote&gt;a quote&lt;/blockquote&gt;.</p>';
  const source = englishSource(`${prose}<pre><code>&lt;p&gt;kept&lt;/p&gt;</code></pre>`);
  assert.equal(
    encodedStructureError(source, 'source'),
    'encoded structural HTML found outside a code example',
  );
  assert.equal(
    encodedStructureError(visibleHtml(source), 'visible'),
    'encoded structural HTML found in visible article body',
  );
  assert.equal(
    encodedStructureError('<p>表格 &lt;thead&gt;&lt;tbody&gt; 坏了</p>', 'visible'),
    'encoded structural HTML found in visible article body',
  );
});

test('encoded tags only inside a translation template do not fail the visible English body', () => {
  const clean = '<h2>Serve the icon</h2><p>Return the file from StaticFiles and keep the href stable.</p>';
  const source = englishSource(clean, `<template data-article-lang="zh">${codeBody}</template>`);
  assert.equal(encodedStructureError(source, 'source'), '');
  assert.equal(encodedStructureError(visibleHtml(source), 'visible'), '');

  const leaked = englishSource(
    clean,
    '<template data-article-lang="zh"><p>坏掉的 &lt;h2&gt;标题&lt;/h2&gt;</p></template>',
  );
  assert.equal(
    encodedStructureError(leaked, 'source'),
    'encoded structural HTML found outside a code example',
  );
  assert.equal(encodedStructureError(visibleHtml(leaked), 'visible'), '');
});

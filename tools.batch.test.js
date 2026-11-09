'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTools(fetchImpl) {
  const context = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: fetchImpl,
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    location: { protocol: 'https:', origin: 'https://favicondl.com', href: 'https://favicondl.com/tools.html', pathname: '/tools.html' },
  };
  context.window = context;
  context.document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return { style: {}, setAttribute() {}, click() {} };
    },
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { lang: 'en' },
  };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'tools.js'), 'utf8');
  vm.runInContext(`${source}\nthis.FaviconTools = FaviconTools;`, context, { filename: 'tools.js' });
  return new context.FaviconTools();
}

test('batch lookup hits same-origin extract without size and strips size from proxy urls', () => {
  const tools = loadTools(async () => {
    throw new Error('not used');
  });
  assert.equal(
    tools.stripProxySize('https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico&size=64'),
    'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico'
  );
  assert.equal(
    tools.stripProxySize('https://icy-glade-6d04favicon.sweeyeah.workers.dev/api/proxy?url=https%3A%2F%2Fa.com%2Fi.png&size=64'),
    'https://icy-glade-6d04favicon.sweeyeah.workers.dev/api/proxy?url=https%3A%2F%2Fa.com%2Fi.png&size=64'
  );
  assert.equal(tools.getBatchDownloadUrl('blob:https://favicondl.com/1111'), 'blob:https://favicondl.com/1111');
});

test('a 429 on extract is retried and the request never asks the server to resize', async () => {
  const urls = [];
  let calls = 0;
  const tools = loadTools(async (url) => {
    urls.push(String(url));
    calls += 1;
    if (calls === 1) {
      return {
        status: 429,
        ok: false,
        headers: { get: () => '0' },
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      status: 200,
      ok: true,
      json: async () => ({
        ok: true,
        proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico&size=256',
      }),
    };
  });
  const data = await tools.fetchFaviconViaWorker('github.com', 256);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/api\/extract\?url=github\.com&format=json$/);
  assert.equal(urls[0].includes('size='), false);
  assert.equal(
    tools.stripProxySize(data.proxyUrl),
    'https://favicondl.com/api/proxy?url=https%3A%2F%2Fgithub.com%2Ffavicon.ico'
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseIcon,
  pageUrls,
  directOrigins,
  parseTarget,
  scoreCandidate,
  firstPageWithIcons,
} = require('./extractor');

test('a 32px site icon outranks a 16px icon at size 512', () => {
  const site = { origin: 'html', rel: 'icon', width: 32, height: 32, format: 'png' };
  const tiny = { origin: 'html', rel: 'icon', width: 16, height: 16, format: 'png' };
  assert.ok(scoreCandidate(site, 512) > scoreCandidate(tiny, 512));
  const chosen = chooseIcon([tiny, site], { source: 'google_s2', width: 16, height: 16, url: 'https://www.google.com/s2/favicons?domain=gnu.org&sz=512' }, 512);
  assert.equal(chosen, site);
});

test('an aggregator image is used only when the site has no verified icon', () => {
  const fallback = { source: 'google_s2', origin: 'google_s2', width: 128, height: 128, url: 'https://www.google.com/s2/favicons?sz=512' };
  assert.equal(chooseIcon([], fallback, 512), fallback);
  const site = { origin: 'direct', rel: 'favicon.ico', width: 18, height: 18, format: 'ico', url: 'https://www.gnu.org/favicon.ico' };
  assert.equal(chooseIcon([site], fallback, 512), site);
});

test('homepage probes include apex and www, and direct icons do too when HTML is missing', () => {
  const target = parseTarget('gnu.org');
  assert.deepEqual(pageUrls(target).https, ['https://gnu.org/', 'https://www.gnu.org/']);
  const origins = directOrigins(target, null);
  assert.ok(origins.includes('https://gnu.org'));
  assert.ok(origins.includes('https://www.gnu.org'));
});

test('a hung homepage probe does not delay one that already found icons', async () => {
  let slowFinished = false;
  const slow = new Promise((resolve) => {
    setTimeout(() => {
      slowFinished = true;
      resolve({ icons: [], manifests: [], finalUrl: 'https://gnu.org/' });
    }, 250);
  });
  const fast = Promise.resolve({
    icons: [{ url: 'https://www.gnu.org/graphics/gnu-head-mini.png' }],
    manifests: [],
    finalUrl: 'https://www.gnu.org/',
  });
  const started = Date.now();
  const page = await firstPageWithIcons([slow, fast], 30);
  assert.equal(page.finalUrl, 'https://www.gnu.org/');
  assert.equal(slowFinished, false);
  assert.ok(Date.now() - started < 200);
});

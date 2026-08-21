import assert from 'node:assert/strict';

import {
  ARTICLE_MODELS,
  TRANSLATION_MODELS,
  classifyModelError,
  ensureFirstPartyEvidence,
  normalizeDescription,
  parseModelList,
  requireStringFields,
  resolveOfficialSources,
  validateKnownPlatformClaims,
} from './generate-article.js';

assert.equal(ARTICLE_MODELS.includes('deepseek-ai/deepseek-v4-flash'), false);
assert.equal(TRANSLATION_MODELS.includes('moonshotai/kimi-k2.6'), false);
assert.equal(TRANSLATION_MODELS.includes('nvidia/nemotron-3.5-lightning-30b-a3b'), false);
assert.equal(TRANSLATION_MODELS.includes('nvidia/nemotron-3-super-120b-a12b'), false);
assert.equal(TRANSLATION_MODELS[0], 'z-ai/glm-5.2');
assert.ok(ARTICLE_MODELS.length >= 4);
assert.ok(TRANSLATION_MODELS.length >= 2);
assert.equal(ARTICLE_MODELS[0], 'openai/gpt-oss-120b');
assert.equal(ARTICLE_MODELS[1], 'z-ai/glm-5.2');
assert.equal(ARTICLE_MODELS.includes('nvidia/nemotron-3.5-lightning-30b-a3b'), false);
assert.deepEqual(parseModelList(' model/a, model/b,model/a ', ['fallback']), ['model/a', 'model/b']);
assert.deepEqual(parseModelList('', ['fallback']), ['fallback']);

assert.equal(classifyModelError({ status: 410, message: 'Gone' }), 'permanent');
assert.equal(classifyModelError({ status: 404, message: 'Not found' }), 'permanent');
assert.equal(classifyModelError({ status: 429, message: 'Rate limited' }), 'transient');
assert.equal(classifyModelError({ status: 401, message: 'Unauthorized' }), 'auth');
assert.equal(classifyModelError({ message: 'The operation was aborted' }), 'timeout');
assert.equal(classifyModelError({ code: 'INVALID_MODEL_OUTPUT', message: 'missing title' }), 'retryable-output');
assert.throws(() => requireStringFields({}, ['titleEn', 'contentEn'], 'test'), /titleEn, contentEn/);
assert.doesNotThrow(() => requireStringFields({ titleEn: 'Title', contentEn: '<p>Body</p>' }, ['titleEn', 'contentEn'], 'test'));

const wixSources = resolveOfficialSources({ keyword: 'wix favicon google search results', tags: ['wix', 'seo'] });
assert.ok(wixSources.some(url => url.includes('support.wix.com')));
assert.ok(wixSources.some(url => url.includes('developers.google.com')));

const guardedWix = ensureFirstPartyEvidence({
  descEn: 'A deliberately overlong description '.repeat(8),
  contentEn: '<p>Wix users may need to troubleshoot a favicon in Google Search.</p>',
}, wixSources);
assert.ok(guardedWix.contentEn.includes('https://support.wix.com/en/article/wix-editor-changing-your-favicon'));
assert.ok(guardedWix.contentEn.includes('https://developers.google.com/search/docs/appearance/favicon-in-search?hl=en'));
assert.ok(guardedWix.contentEn.includes('Check the documented requirements'));
assert.ok(guardedWix.descEn.length <= 160);
assert.ok(normalizeDescription('Short factual description.').length <= 160);
assert.throws(() => validateKnownPlatformClaims({
  titleEn: 'Wix favicon in Google',
  contentEn: '<p>Google requires a favicon of at least 48x48. Go to Wix Custom Code and paste a link tag into the head.</p>',
}, 'wix favicon google search results'), /平台事实校验失败/);
assert.doesNotThrow(() => validateKnownPlatformClaims({
  titleEn: 'Wix favicon in Google',
  contentEn: '<p>Google requires at least 8x8 and recommends larger than 48x48. Use Wix Website settings and keep the URL stable.</p>',
}, 'wix favicon google search results'));

const nextSources = resolveOfficialSources({ keyword: 'nextjs app router favicon', tags: ['nextjs'] });
assert.ok(nextSources.some(url => url.includes('nextjs.org')));

console.log('FaviconDL generator resilience tests passed.');

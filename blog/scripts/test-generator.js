import assert from 'node:assert/strict';

import {
  ARTICLE_MODELS,
  TRANSLATION_MODELS,
  classifyModelError,
  parseModelList,
  resolveOfficialSources,
} from './generate-article.js';

assert.equal(ARTICLE_MODELS.includes('deepseek-ai/deepseek-v4-flash'), false);
assert.equal(TRANSLATION_MODELS.includes('moonshotai/kimi-k2.6'), false);
assert.ok(ARTICLE_MODELS.length >= 4);
assert.deepEqual(parseModelList(' model/a, model/b,model/a ', ['fallback']), ['model/a', 'model/b']);
assert.deepEqual(parseModelList('', ['fallback']), ['fallback']);

assert.equal(classifyModelError({ status: 410, message: 'Gone' }), 'permanent');
assert.equal(classifyModelError({ status: 404, message: 'Not found' }), 'permanent');
assert.equal(classifyModelError({ status: 429, message: 'Rate limited' }), 'transient');
assert.equal(classifyModelError({ status: 401, message: 'Unauthorized' }), 'auth');
assert.equal(classifyModelError({ message: 'The operation was aborted' }), 'timeout');

const wixSources = resolveOfficialSources({ keyword: 'wix favicon google search results', tags: ['wix', 'seo'] });
assert.ok(wixSources.some(url => url.includes('support.wix.com')));
assert.ok(wixSources.some(url => url.includes('developers.google.com')));

const nextSources = resolveOfficialSources({ keyword: 'nextjs app router favicon', tags: ['nextjs'] });
assert.ok(nextSources.some(url => url.includes('nextjs.org')));

console.log('FaviconDL generator resilience tests passed.');

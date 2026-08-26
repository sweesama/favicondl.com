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
  validateTranslationContent,
  validateKnownPlatformClaims,
} from './generate-article.js';

assert.equal(ARTICLE_MODELS.includes('z-ai/glm-5.2'), false);
assert.equal(ARTICLE_MODELS.includes('openai/gpt-oss-120b'), false);
assert.equal(ARTICLE_MODELS.includes('nvidia/nemotron-3-nano-30b-a3b'), false);
assert.equal(TRANSLATION_MODELS.includes('z-ai/glm-5.2'), false);
assert.equal(TRANSLATION_MODELS.includes('openai/gpt-oss-120b'), false);
assert.equal(TRANSLATION_MODELS[0], 'deepseek-ai/deepseek-v4-flash-0731');
assert.ok(ARTICLE_MODELS.length >= 4);
assert.ok(TRANSLATION_MODELS.length >= 3);
assert.equal(ARTICLE_MODELS[0], 'nvidia/nemotron-3-ultra-550b-a55b');
assert.equal(ARTICLE_MODELS[1], 'deepseek-ai/deepseek-v4-flash-0731');
assert.equal(TRANSLATION_MODELS[1], 'nvidia/nemotron-3-ultra-550b-a55b');
assert.equal(ARTICLE_MODELS.includes('stepfun-ai/step-3.7-flash'), true);
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

const sourceHtml = "<h2>Check it</h2><p>Use <strong>one</strong> <a href='https://example.com/docs'>source</a>.</p><ul><li><code>favicon.ico</code></li></ul>";
const validTranslation = "<h2>检查方法</h2><p>使用<strong>一个</strong><a href='https://example.com/docs'>来源</a>。</p><ul><li><code>favicon.ico</code></li></ul>";
assert.doesNotThrow(() => validateTranslationContent(sourceHtml, validTranslation, '中文翻译'));
assert.throws(
  () => validateTranslationContent(sourceHtml, validTranslation.replace('</strong>', '</code>'), '中文翻译'),
  /HTML 标签闭合错误|改变了英文原文的 HTML 结构/,
);
assert.throws(
  () => validateTranslationContent(sourceHtml, validTranslation.replace('https://example.com/docs', 'https://example.com/other'), '中文翻译'),
  /改变、遗漏或新增了英文原文链接/,
);

const nextSources = resolveOfficialSources({ keyword: 'nextjs app router favicon', tags: ['nextjs'] });
assert.ok(nextSources.some(url => url.includes('nextjs.org')));

console.log('FaviconDL generator resilience tests passed.');

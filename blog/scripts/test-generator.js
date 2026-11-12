import assert from 'node:assert/strict';

import {
  API_TIMEOUT_MS,
  ARTICLE_MODELS,
  TRANSLATION_API_TIMEOUT_MS,
  TRANSLATION_MODELS,
  callAI,
  classifyModelError,
  escapeUnexpectedHtmlTags,
  ensureFirstPartyEvidence,
  isModelDisabled,
  normalizeDescription,
  parseModelList,
  parseModelRoute,
  requireStringFields,
  resetRoutingStateForTests,
  resolveOfficialSources,
  retryBackoffMs,
  splitTranslationChunks,
  translateArticleBody,
  validateTranslationContent,
  validateKnownPlatformClaims,
  validateArticleData,
} from './generate-article.js';

assert.equal(ARTICLE_MODELS.includes('stepfun-ai/step-3.7-flash'), false);
assert.equal(TRANSLATION_MODELS.includes('stepfun-ai/step-3.7-flash'), false);
assert.equal(TRANSLATION_MODELS[0], 'minimax:MiniMax-M3');
assert.equal(ARTICLE_MODELS.length, 2);
assert.equal(TRANSLATION_MODELS.length, 2);
assert.equal(ARTICLE_MODELS[0], 'minimax:MiniMax-M3');
assert.equal(ARTICLE_MODELS[1], 'deepseek:deepseek-v4-flash');
assert.equal(TRANSLATION_MODELS[1], 'deepseek:deepseek-v4-flash');
assert.deepEqual(parseModelList(' model/a, model/b,model/a ', ['fallback']), ['model/a', 'model/b']);
assert.deepEqual(parseModelList('', ['fallback']), ['fallback']);
assert.deepEqual(parseModelRoute('minimax:MiniMax-M3'), { provider: 'minimax', model: 'MiniMax-M3', routeName: 'minimax:MiniMax-M3' });
assert.deepEqual(parseModelRoute('nvidia/nemotron-test'), { provider: 'nvidia', model: 'nvidia/nemotron-test', routeName: 'nvidia/nemotron-test' });

assert.equal(classifyModelError({ status: 410, message: 'Gone' }), 'permanent');
assert.equal(classifyModelError({ status: 404, message: 'Not found' }), 'permanent');
assert.equal(classifyModelError({ status: 429, message: 'Rate limited' }), 'transient');
assert.equal(classifyModelError({ status: 401, message: 'Unauthorized' }), 'auth');
assert.equal(classifyModelError({ code: 'PROVIDER_UNCONFIGURED' }), 'unconfigured');
assert.equal(classifyModelError({ message: 'The operation was aborted' }), 'timeout');
assert.equal(classifyModelError({ message: 'Request was aborted' }), 'timeout');
assert.equal(classifyModelError({ message: 'The user aborted a request' }), 'timeout');
assert.equal(classifyModelError({ name: 'AbortError', message: 'This operation was aborted' }), 'timeout');
assert.equal(API_TIMEOUT_MS, 180000);
assert.equal(TRANSLATION_API_TIMEOUT_MS, 480000);
assert.ok(TRANSLATION_API_TIMEOUT_MS > API_TIMEOUT_MS);
assert.equal(retryBackoffMs('timeout', 1), 5000);
assert.equal(retryBackoffMs('timeout', 2), 10000);
assert.ok(retryBackoffMs('transient', 2) > retryBackoffMs('transient', 1));
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
assert.doesNotThrow(
  () => validateTranslationContent(sourceHtml, validTranslation.replace('来源', '<em>来源</em>'), '中文翻译'),
);
assert.throws(
  () => validateTranslationContent(sourceHtml, validTranslation.replace('<li><code>favicon.ico</code></li>', ''), '中文翻译'),
  /改变了英文原文的段落\/标题\/列表\/表格结构/,
);
assert.equal(
  escapeUnexpectedHtmlTags('<p>Use <metadata> in Next.js.</p>'),
  '<p>Use &lt;metadata&gt; in Next.js.</p>',
);
assert.equal(
  escapeUnexpectedHtmlTags('<p>Safe</p><script>alert(1)</script>'),
  '<p>Safe</p><script>alert(1)</script>',
);

const nextSources = resolveOfficialSources({ keyword: 'nextjs app router favicon', tags: ['nextjs'] });
assert.ok(nextSources.some(url => url.includes('nextjs.org')));

const sectionA = "<h2>Section A</h2><p>First part with <a href='https://example.com/a'>source</a>.</p>";
const sectionB = "<h2>Section B</h2><p>Second part with <a href='https://example.com/b'>source</a>.</p>";
const longArticle = `${sectionA}${sectionB}`;
assert.deepEqual(splitTranslationChunks(sectionA, 2400), [sectionA]);
assert.deepEqual(splitTranslationChunks(longArticle, sectionA.length), [sectionA, sectionB]);
assert.equal(splitTranslationChunks(longArticle, sectionA.length).join(''), longArticle);
const nestedList = "<ul><li><code>favicon.ico</code></li><li>second</li></ul>";
assert.deepEqual(splitTranslationChunks(nestedList, 10), [nestedList]);
const chunkedSource = splitTranslationChunks(sourceHtml, 80);
assert.ok(chunkedSource.length >= 2);
assert.equal(chunkedSource.join(''), sourceHtml);

function fragmentFromPrompt(prompt) {
  const match = String(prompt).match(/=== ENGLISH ARTICLE TO ADAPT ===\nTitle: [^\n]*\n\n([\s\S]*)$/);
  assert.ok(match, 'translation prompt keeps the English fragment');
  return match[1];
}

function completion(content) {
  return { choices: [{ message: { content: JSON.stringify({ content }) } }] };
}

const incidentModels = ['minimax:MiniMax-M3', 'deepseek:deepseek-v4-flash'];

resetRoutingStateForTests();
const incidentCalls = [];
const incidentSleeps = [];
const incidentTimeouts = [];
const incident = await callAI(
  'Return JSON',
  'translate-Ja',
  0.45,
  incidentModels,
  TRANSLATION_API_TIMEOUT_MS,
  null,
  {
    requestModel: async (modelName, _prompt, _temperature, _jsonMode, timeoutMs) => {
      incidentCalls.push(modelName);
      incidentTimeouts.push(timeoutMs);
      if (modelName === 'minimax:MiniMax-M3') throw new Error('Request was aborted');
      if (modelName === 'deepseek:deepseek-v4-flash') return completion('<p>日本語の本文</p>');
      throw new Error(`unexpected model ${modelName}`);
    },
    sleep: async (ms) => { incidentSleeps.push(ms); },
  },
);
assert.equal(incident.content, '<p>日本語の本文</p>');
assert.deepEqual(incidentCalls, ['minimax:MiniMax-M3', 'minimax:MiniMax-M3', 'deepseek:deepseek-v4-flash']);
assert.deepEqual(incidentSleeps, [retryBackoffMs('timeout', 1)]);
assert.deepEqual(incidentTimeouts, [TRANSLATION_API_TIMEOUT_MS, TRANSLATION_API_TIMEOUT_MS, TRANSLATION_API_TIMEOUT_MS]);
assert.equal(isModelDisabled('minimax:MiniMax-M3'), false);

const secondPassCalls = [];
await callAI('Return JSON', 'translate-Ja', 0.45, incidentModels, 1000, null, {
  requestModel: async (modelName) => {
    secondPassCalls.push(modelName);
    if (modelName === 'minimax:MiniMax-M3') throw new Error('Request was aborted');
    return completion('<p>二回目</p>');
  },
  sleep: async () => {},
});
assert.equal(secondPassCalls[0], 'minimax:MiniMax-M3');
assert.equal(isModelDisabled('minimax:MiniMax-M3'), true);

const thirdPassCalls = [];
await callAI('Return JSON', 'translate-Ja', 0.45, incidentModels, 1000, null, {
  requestModel: async (modelName) => {
    thirdPassCalls.push(modelName);
    return completion('<p>三回目</p>');
  },
  sleep: async () => {},
});
assert.deepEqual(thirdPassCalls, ['deepseek:deepseek-v4-flash']);

resetRoutingStateForTests();
await assert.rejects(
  () => callAI('Return JSON', 'translate-Ja', 0.45, incidentModels, 1000, null, {
    requestModel: async (modelName) => {
      throw new Error(modelName.startsWith('minimax') ? 'Request was aborted' : 'The user aborted a request');
    },
    sleep: async () => {},
  }),
  /\[translate-Ja\] 所有模型均调用失败/,
);

resetRoutingStateForTests();
const chunkCalls = [];
const chunkTimeouts = [];
const translated = await translateArticleBody(longArticle, 'Why Is My Favicon Blurry?', { code: 'Ja', name: '日本語' }, 'why is my favicon blurry', {
  chunkBudget: sectionA.length,
  models: incidentModels,
  requestModel: async (modelName, prompt, _temperature, _jsonMode, timeoutMs) => {
    chunkCalls.push(modelName);
    chunkTimeouts.push(timeoutMs);
    if (modelName === 'minimax:MiniMax-M3') throw new Error('Request was aborted');
    const fragment = fragmentFromPrompt(prompt);
    assert.match(prompt, /FRAGMENT SCOPE/);
    return completion(fragment.replace('Section A', '節A').replace('Section B', '節B'));
  },
  sleep: async () => {},
});
assert.equal(chunkCalls.filter(model => model === 'minimax:MiniMax-M3').length, 4);
assert.equal(chunkCalls.filter(model => model === 'deepseek:deepseek-v4-flash').length, 2);
assert.ok(chunkTimeouts.every(timeoutMs => timeoutMs === TRANSLATION_API_TIMEOUT_MS));
assert.equal(chunkCalls[0], 'minimax:MiniMax-M3');
assert.equal(chunkCalls[1], 'minimax:MiniMax-M3');
assert.equal(chunkCalls[2], 'deepseek:deepseek-v4-flash');
validateTranslationContent(longArticle, translated, '日本語翻译');
assert.ok(translated.includes('節A'));
assert.ok(translated.includes('節B'));
assert.ok(translated.includes("href='https://example.com/a'"));
assert.ok(translated.includes("href='https://example.com/b'"));

resetRoutingStateForTests();
await assert.rejects(
  () => translateArticleBody(longArticle, 'Why Is My Favicon Blurry?', { code: 'Ja', name: '日本語' }, 'why is my favicon blurry', {
    chunkBudget: sectionA.length,
    models: incidentModels,
    requestModel: async (modelName, prompt) => {
      if (modelName === 'minimax:MiniMax-M3') throw new Error('Request was aborted');
      const fragment = fragmentFromPrompt(prompt);
      if (fragment.includes('Section B')) throw new Error('The user aborted a request');
      return completion(fragment.replace('Section A', '節A'));
    },
    sleep: async () => {},
  }),
  /所有模型均调用失败/,
);

resetRoutingStateForTests();
await assert.rejects(
  () => translateArticleBody(sourceHtml, 'Check it', { code: 'Ja', name: '日本語' }, 'favicon', {
    chunkBudget: 100000,
    models: incidentModels,
    requestModel: async (modelName) => {
      if (modelName === 'minimax:MiniMax-M3') throw new Error('Request was aborted');
      return completion('<p>構造を落とした翻訳</p>');
    },
    sleep: async () => {},
  }),
  /所有模型均调用失败：[\s\S]*(HTML タグ閉合錯誤|段落\/标题\/列表\/表格结构|改变了英文原文)/,
);

// 2026-11-12 run 43170908506：fastapi favicon 的中文 chunk #2 四次失败，
// 报错都是「包含被转义的结构标签」。how-to 代码块里的 &lt;a&gt; / &lt;p&gt; / &lt;code&gt; 是合法示例。
const codeSample = "<pre><code>&lt;a href='/docs'&gt;API&lt;/a&gt;\n&lt;p&gt;icon&lt;/p&gt;\n&lt;code&gt;favicon.ico&lt;/code&gt;\n&lt;h2&gt;FastAPI&lt;/h2&gt;</code></pre>";
const inlineSample = "<p>写在 <code>&lt;a href='/favicon.ico'&gt;</code> 和 <code>&lt;code&gt;rel='icon'&lt;/code&gt;</code> 里。</p>";
assert.doesNotThrow(() => validateTranslationContent(
  `<p>Return HTML from the index route.</p>${codeSample}`,
  `<p>从首页路由返回 HTML。</p>${codeSample}`,
  '中文翻译输出',
));
assert.doesNotThrow(() => validateTranslationContent(
  "<p>Write <code>&lt;a href='/favicon.ico'&gt;</code> and <code>&lt;code&gt;rel='icon'&lt;/code&gt;</code>.</p>",
  inlineSample,
  '中文翻译输出',
));
assert.doesNotThrow(() => validateTranslationContent(
  "<p>Upper</p><PRE><CODE>&lt;p&gt;Hi&lt;/p&gt;&lt;a href='/'&gt;home&lt;/a&gt;</CODE></PRE>",
  "<p>大写标签</p><PRE><CODE>&lt;p&gt;Hi&lt;/p&gt;&lt;a href='/'&gt;home&lt;/a&gt;</CODE></PRE>",
  '中文翻译输出',
));
assert.throws(
  () => validateTranslationContent(
    '<p>See the next section.</p>',
    '<p>参见 &lt;h2&gt;下一节&lt;/h2&gt; 与 &lt;p&gt;正文&lt;/p&gt;。</p>',
    '中文翻译输出',
  ),
  /中文翻译输出 包含被转义的结构标签/,
);
assert.throws(
  () => validateTranslationContent(
    `<p>See below.</p>${codeSample}`,
    `<p>见 &lt;h2&gt;下一节&lt;/h2&gt;。</p>${codeSample}`,
    '中文翻译输出',
  ),
  /被转义的结构标签/,
);

const escapedTagArticle = {
  contentEn: `<p>See &lt;h2&gt;next&lt;/h2&gt;.</p>`,
  contentZh: inlineSample,
  contentJa: '<p>見よ &lt;p&gt;壊れ&lt;/p&gt;</p>',
  contentKo: `<p>예시</p>${codeSample}`,
  contentEs: '<p>Mira &lt;table&gt;&lt;tr&gt;&lt;td&gt;roto&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</p>',
};
assert.throws(() => validateArticleData(escapedTagArticle, 'fastapi favicon', 'brief'), error => {
  assert.match(error.message, /英文 包含被转义的结构标签/);
  assert.match(error.message, /日文 包含被转义的结构标签/);
  assert.match(error.message, /西班牙文 包含被转义的结构标签/);
  assert.doesNotMatch(error.message, /中文 包含被转义的结构标签/);
  assert.doesNotMatch(error.message, /韩文 包含被转义的结构标签/);
  return true;
});

const preWithTagLikeText = `<pre><code>if (html.includes("</p>")) {\n  names: Array<string>;\n  return "&lt;a href='/'&gt;&lt;code&gt;x&lt;/code&gt;";\n}</code></pre>`;
const splittable = `<p>Before</p>${preWithTagLikeText}<h2>After</h2><p>Tail</p>`;
const splitted = splitTranslationChunks(splittable, 40);
assert.equal(splitted.join(''), splittable);
assert.ok(splitted.some(chunk => chunk.includes('<pre') && chunk.includes('</pre>') && !chunk.includes('<h2>')));
assert.ok(splitted.some(chunk => chunk.startsWith('<h2>After</h2>')));
for (const chunk of splitted) {
  assert.equal((chunk.match(/<pre\b/gi) || []).length, (chunk.match(/<\/pre>/gi) || []).length);
}
const escapedCloser = `<p>Before</p><pre><code>literal &lt;/pre&gt; and &lt;/code&gt; stay inside</code></pre><h2>After</h2>`;
const escapedCloserChunks = splitTranslationChunks(escapedCloser, 20);
assert.equal(escapedCloserChunks.join(''), escapedCloser);
assert.equal(escapedCloserChunks.filter(chunk => /<pre\b/i.test(chunk) && !/<\/pre>/i.test(chunk)).length, 0);
assert.ok(escapedCloserChunks.some(chunk => chunk.startsWith('<h2>After</h2>')));

const section1 = `<h2>Why it 404s</h2><p>${'Browser requests /favicon.ico. '.repeat(80)}</p>`;
const section2 = `<h2>Serve it</h2><p>Return HTML from the index route.</p>${codeSample}`;
const section3 = `<h2>Check it</h2><p>${'Expect image bytes. '.repeat(80)}</p>`;
const fastapiArticle = section1 + section2 + section3;
const fastapiChunks = splitTranslationChunks(fastapiArticle, 2400);
assert.ok(fastapiChunks.length >= 2);
const failingChunk = fastapiChunks.find(chunk => chunk.includes("&lt;a href='/docs'&gt;"));
assert.ok(failingChunk);
assert.equal((failingChunk.match(/<pre\b/g) || []).length, (failingChunk.match(/<\/pre>/g) || []).length);
assert.doesNotThrow(() => validateTranslationContent(failingChunk, failingChunk, '中文翻译输出'));

resetRoutingStateForTests();
const translatedArticle = await translateArticleBody(
  fastapiArticle,
  'FastAPI Favicon Setup',
  { code: 'Zh', name: '中文' },
  'fastapi favicon',
  {
    chunkBudget: 2400,
    models: ['deepseek:deepseek-v4-flash'],
    requestModel: async (_model, prompt) => completion(
      fragmentFromPrompt(prompt).replace('Return HTML from the index route.', '从首页路由返回 HTML。'),
    ),
    sleep: async () => {},
  },
);
assert.ok(translatedArticle.includes('从首页路由返回 HTML。'));
assert.ok(translatedArticle.includes("&lt;code&gt;favicon.ico&lt;/code&gt;"));
assert.equal(translatedArticle.includes('&lt;h2&gt;下一节'), false);

resetRoutingStateForTests();
await assert.rejects(
  () => translateArticleBody('<p>See the next section.</p>', 'FastAPI Favicon', { code: 'Zh', name: '中文' }, 'fastapi favicon', {
    chunkBudget: 100000,
    models: ['deepseek:deepseek-v4-flash'],
    requestModel: async () => completion('<p>参见 &lt;h2&gt;下一节&lt;/h2&gt; 与 &lt;p&gt;正文&lt;/p&gt;。</p>'),
    sleep: async () => {},
  }),
  /中文翻译输出 包含被转义的结构标签/,
);

console.log('FaviconDL generator resilience tests passed.');

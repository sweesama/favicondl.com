/**
 * 自动博客文章生成脚本（v6 — 可恢复模型路由 + 来源约束）
 * 
 * v4 改进：
 * - 反 AI 八股文：Prompt 禁止 20+ 条常见 AI 套话，要求真实品牌案例和第一人称视角
 * - AI 套话检测：验证阶段自动扫描生成内容中的 AI 陈词滥调
 * - Schema.org Bug 修复：JSON-LD 改用 JSON.stringify（不再错误使用 HTML 实体）
 * - 温度 0.55：平衡准确性与可读性
 * - API 超时与失效模型熔断：404/410 后本轮不再重复调用
 * - 官方来源注入：平台、框架和浏览器事实必须有第一方链接
 * - 元数据局部修复：缺少单个语言描述时不再废弃整篇文章
 * - 动态版权年份
 * 
 * v3 基础：
 * - NVIDIA NIM 免费端点的多模型路由
 * - 意图感知 / 自适应长度 / 语义去重 / 现代 SEO / response_format: JSON
 * 
 * 使用方式：
 *   NVIDIA_API_KEY=xxx node generate-article.js
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ============================================================
// 配置常量
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BLOG_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(BLOG_DIR, '..');
const QUEUE_PATH = path.join(BLOG_DIR, 'queue.json');
const ARTICLES_PATH = path.join(BLOG_DIR, 'articles.json');
const SITEMAP_PATH = path.join(ROOT_DIR, 'sitemap.xml');

// API 配置（NVIDIA NIM — OpenAI 兼容接口）
const API_KEY = process.env.NVIDIA_API_KEY;
const ai = API_KEY ? new OpenAI({
  apiKey: API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
}) : null;

function parseModelList(value, fallback) {
  const parsed = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  return parsed.length > 0 ? [...new Set(parsed)] : fallback;
}

// NVIDIA 的免费托管端点是开发/原型服务，会轮换且可能限流。
// 默认池只放入 2026-08-26 在官方目录中仍标记为 Free Endpoint: Available 的文本模型；
// 名单仍可由环境变量覆盖，运行时会自动熔断失效或持续超时的端点。
const ARTICLE_MODELS = parseModelList(process.env.BLOG_MODEL_LIST, [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'stepfun-ai/step-3.7-flash',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
]);
const TRANSLATION_MODELS = parseModelList(process.env.BLOG_TRANSLATION_MODEL_LIST, [
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3-super-120b-a12b',
  'stepfun-ai/step-3.7-flash',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 12000;
const API_TIMEOUT_MS = Number(process.env.BLOG_API_TIMEOUT_MS || 180000);
const TRANSLATION_API_TIMEOUT_MS = Number(process.env.BLOG_TRANSLATION_API_TIMEOUT_MS || 180000);
const disabledModels = new Set();

const GENERAL_FAVICON_SOURCE = 'https://html.spec.whatwg.org/multipage/links.html#rel-icon';
const SOURCE_EVIDENCE = new Map([
  ['https://developers.google.com/search/docs/appearance/favicon-in-search?hl=en', "Google's <a href='https://developers.google.com/search/docs/appearance/favicon-in-search?hl=en'>favicon documentation for Search</a> explains the crawlability, URL, and image requirements Google uses when it considers a site's favicon."],
  ['https://support.wix.com/en/article/wix-editor-changing-your-favicon', "Wix's <a href='https://support.wix.com/en/article/wix-editor-changing-your-favicon'>favicon guide</a> shows the dashboard steps for uploading an icon and states that the site must already be published before adding it."],
  ['https://help.webflow.com/hc/en-us/articles/33961293384147-Add-a-favicon-or-webclip', "Webflow's <a href='https://help.webflow.com/hc/en-us/articles/33961293384147-Add-a-favicon-or-webclip'>favicon and webclip guide</a> identifies the project settings used for each asset."],
  ['https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons', "Next.js documents favicons and app icons in its <a href='https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons'>metadata file conventions</a>."],
  ['https://vite.dev/guide/assets.html#the-public-directory', "Vite's <a href='https://vite.dev/guide/assets.html#the-public-directory'>public directory documentation</a> explains how root-path assets are copied without transformation."],
  ['https://docs.astro.build/en/basics/project-structure/#public', "Astro's <a href='https://docs.astro.build/en/basics/project-structure/#public'>project structure guide</a> documents the public directory for assets that should be copied unchanged."],
  ['https://v2.remix.run/docs/route/links/', "Remix documents page-level link descriptors, including icon relationships, in its <a href='https://v2.remix.run/docs/route/links/'>route links guide</a>."],
  ['https://svelte.dev/docs/kit/project-structure', "SvelteKit's <a href='https://svelte.dev/docs/kit/project-structure'>project structure documentation</a> explains where static assets belong."],
  ['https://nuxt.com/docs/4.x/getting-started/seo-meta', "Nuxt's <a href='https://nuxt.com/docs/4.x/getting-started/seo-meta'>SEO and meta guide</a> documents how link metadata is configured."],
  ['https://www.w3.org/TR/appmanifest/#icons-member', "The Web App Manifest specification defines the <a href='https://www.w3.org/TR/appmanifest/#icons-member'>icons member</a> as a list of image resources for an application."],
  [GENERAL_FAVICON_SOURCE, "The HTML Standard defines <a href='https://html.spec.whatwg.org/multipage/links.html#rel-icon'><code>rel='icon'</code></a> as the link relationship for an icon representing the current page."],
]);
const SOURCE_NOTES = new Map([
  ['https://developers.google.com/search/docs/appearance/favicon-in-search?hl=en', 'Google: a favicon is eligible, not guaranteed. It must be square and at least 8x8; larger than 48x48 is recommended. Keep its URL stable. Recrawling can take several days to several weeks.'],
  ['https://support.wix.com/en/article/wix-editor-changing-your-favicon', 'Wix: use Dashboard > Settings > Website settings > Upload Image under Favicon. A Premium plan, connected domain, and previously published site are required. Non-SVG dimensions must be multiples of 48px. Do not present Custom Code as the normal setup route.'],
  ['https://vite.dev/guide/assets.html#the-public-directory', 'Vite: files in public are served at the root path, copied to the build output unchanged, and referenced as /icon.png rather than /public/icon.png.'],
]);
const SOURCE_RULES = [
  { match: /google|search results?|48x48|96x96/i, urls: ['https://developers.google.com/search/docs/appearance/favicon-in-search?hl=en'] },
  { match: /wix/i, urls: ['https://support.wix.com/en/article/wix-editor-changing-your-favicon'] },
  { match: /webflow/i, urls: ['https://help.webflow.com/hc/en-us/articles/33961293384147-Add-a-favicon-or-webclip'] },
  { match: /next\.?js/i, urls: ['https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons'] },
  { match: /vite|react vite|vue vite/i, urls: ['https://vite.dev/guide/assets.html#the-public-directory'] },
  { match: /astro/i, urls: ['https://docs.astro.build/en/basics/project-structure/#public'] },
  { match: /remix/i, urls: ['https://v2.remix.run/docs/route/links/'] },
  { match: /sveltekit/i, urls: ['https://svelte.dev/docs/kit/project-structure'] },
  { match: /nuxt/i, urls: ['https://nuxt.com/docs/4.x/getting-started/seo-meta'] },
  { match: /manifest|pwa|android|home screen/i, urls: ['https://www.w3.org/TR/appmanifest/#icons-member'] },
  { match: /svg|png|ico|browser|favicon/i, urls: [GENERAL_FAVICON_SOURCE] },
];

function resolveOfficialSources(item) {
  const haystack = `${item.keyword || ''} ${(item.tags || []).join(' ')}`;
  const explicit = Array.isArray(item.sourceUrls) ? item.sourceUrls : [];
  const matched = SOURCE_RULES.filter(rule => rule.match.test(haystack)).flatMap(rule => rule.urls);
  const sources = [...new Set([...explicit, ...matched])];
  if (sources.length === 0) sources.push(GENERAL_FAVICON_SOURCE);
  return sources.slice(0, 4);
}

// 按 depth 字段对应的词数范围（英文词数）
const DEPTH_CONFIG = {
  brief: { minWords: 300, maxWords: 500, label: '简短' },
  standard: { minWords: 600, maxWords: 900, label: '标准' },
  deep: { minWords: 1000, maxWords: 1500, label: '深度' },
};

// 禁止直接出现在正文 DOM 中的危险或页面级 HTML 标签。
const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'h1'];
const ALLOWED_CONTENT_TAGS = new Set([
  'p', 'h2', 'h3', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'br'
]);
const VOID_CONTENT_TAGS = new Set(['br']);

// CTA 链接白名单
const VALID_CTA_LINKS = ['/index.html', '/tools.html', '/documentation.html'];

// AI 输出必须包含的字段
const REQUIRED_FIELDS = [
  'titleEn', 'titleZh', 'titleJa', 'titleKo', 'titleEs',
  'descEn', 'descZh', 'descJa', 'descKo', 'descEs',
  'metaKeywords',
  'breadcrumbEn', 'breadcrumbZh', 'breadcrumbJa', 'breadcrumbKo', 'breadcrumbEs',
  'contentEn', 'contentZh', 'contentJa', 'contentKo', 'contentEs',
  'ctaTitleEn', 'ctaTitleZh', 'ctaTitleJa', 'ctaTitleKo', 'ctaTitleEs',
  'ctaDescEn', 'ctaDescZh', 'ctaDescJa', 'ctaDescKo', 'ctaDescEs',
  'ctaBtnEn', 'ctaBtnZh', 'ctaBtnJa', 'ctaBtnKo', 'ctaBtnEs',
  'ctaLink'
];

// ============================================================
// 主函数
// ============================================================

async function main() {
  if (!ai) throw new Error('缺少 NVIDIA_API_KEY 环境变量');
  console.log('🚀 开始自动生成博客文章...\n');

  // --- 前置检查 ---
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const articles = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf-8'));
  const existingSlugs = new Set(articles.map(a => a.slug));

  // 找到第一个 pending 且不与已发布文章重复的关键词
  const nextItem = queue.find(item =>
    item.status === 'pending' && !existingSlugs.has(item.slug)
  );

  if (!nextItem) {
    console.log('✅ 所有关键词已处理完毕，没有新文章需要生成。');
    process.exit(0);
  }

  // 检查 HTML 文件是否已存在（防止覆盖）
  const htmlPath = path.join(BLOG_DIR, `${nextItem.slug}.html`);
  if (fs.existsSync(htmlPath)) {
    console.log(`⚠️ 文件 ${nextItem.slug}.html 已存在，跳过此关键词并标记为 done`);
    nextItem.status = 'done';
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    process.exit(0);
  }

  // 读取队列项属性（兼容没有新字段的旧格式）
  const intent = nextItem.intent || 'informational';
  const depth = nextItem.depth || 'standard';
  const avoidOverlap = nextItem.avoidOverlap || [];
  const sourceUrls = resolveOfficialSources(nextItem);
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;

  console.log(`📝 关键词: "${nextItem.keyword}"`);
  console.log(`📄 输出: ${nextItem.slug}.html`);
  console.log(`🏷️  标签: [${nextItem.tags.join(', ')}]`);
  console.log(`🎯 意图: ${intent} | 深度: ${depthCfg.label}(${depthCfg.minWords}-${depthCfg.maxWords}词)\n`);
  console.log(`📚 官方来源: ${sourceUrls.join(', ')}\n`);

  const today = new Date().toISOString().split('T')[0];

  // --- 备份当前状态（用于回滚） ---
  const backups = {
    articles: fs.readFileSync(ARTICLES_PATH, 'utf-8'),
    queue: fs.readFileSync(QUEUE_PATH, 'utf-8'),
    sitemap: fs.readFileSync(SITEMAP_PATH, 'utf-8'),
  };

  try {
    // --- 调用 AI 生成 ---
    const articleData = await generateArticleContent(
      nextItem.keyword, nextItem.slug, nextItem.tags,
      articles, intent, depth, avoidOverlap, sourceUrls
    );

    // --- 净化 HTML ---
    articleData.contentEn = sanitizeHTML(articleData.contentEn);
    articleData.contentZh = sanitizeHTML(articleData.contentZh);
    articleData.contentJa = sanitizeHTML(articleData.contentJa);
    articleData.contentKo = sanitizeHTML(articleData.contentKo);
    articleData.contentEs = sanitizeHTML(articleData.contentEs);

    // --- 质量评分 ---
    const { score: qualityScore, grade: qualityGrade } = scoreArticleQuality(articleData, nextItem.keyword, depth, intent);

    // --- 写入文件 ---
    const htmlContent = buildHTML(articleData, nextItem, today);
    fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
    console.log(`✅ 已生成 HTML: ${nextItem.slug}.html`);

    // 更新 articles.json（含评分）
    articles.push({
      slug: nextItem.slug,
      publishDate: today,
      titleEn: articleData.titleEn,
      titleZh: articleData.titleZh,
      titleJa: articleData.titleJa,
      titleKo: articleData.titleKo,
      titleEs: articleData.titleEs,
      descEn: articleData.descEn,
      descZh: articleData.descZh,
      descJa: articleData.descJa,
      descKo: articleData.descKo,
      descEs: articleData.descEs,
      keyword: nextItem.keyword,
      tags: nextItem.tags,
      qualityScore,
      qualityGrade
    });
    fs.writeFileSync(ARTICLES_PATH, JSON.stringify(articles, null, 2) + '\n', 'utf-8');
    console.log('✅ 已更新 articles.json');

    // 更新 sitemap.xml
    updateSitemap(nextItem.slug, today);
    console.log('✅ 已更新 sitemap.xml');

    // 标记队列项为已完成（含评分）
    nextItem.status = 'done';
    nextItem.qualityScore = qualityScore;
    nextItem.qualityGrade = qualityGrade;
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + '\n', 'utf-8');
    console.log('✅ 已更新 queue.json');

    // --- 最终输出 ---
    const gradeEmoji = qualityGrade === 'A' ? '🏆' : qualityGrade === 'B' ? '👍' : '⚠️';
    console.log('\n' + '='.repeat(50));
    console.log(`🎉 文章发布成功! ${gradeEmoji} 质量 ${qualityGrade}级 (${qualityScore}/100)`);
    console.log(`   EN: ${articleData.titleEn}`);
    console.log(`   ZH: ${articleData.titleZh}`);
    console.log(`   JA: ${articleData.titleJa}`);
    console.log(`   KO: ${articleData.titleKo}`);
    console.log(`   ES: ${articleData.titleEs}`);
    console.log(`   文件: blog/${nextItem.slug}.html`);
    console.log(`   日期: ${today}`);
    console.log(`   EN: ${articleData.contentEn.length} 字符`);
    console.log(`   ZH: ${articleData.contentZh.length} 字符`);
    console.log(`   JA: ${articleData.contentJa.length} 字符`);
    console.log(`   KO: ${articleData.contentKo.length} 字符`);
    console.log(`   ES: ${articleData.contentEs.length} 字符`);
    console.log('='.repeat(50));

  } catch (err) {
    // --- 回滚所有改动 ---
    console.error(`\n❌ 生成失败: ${err.message}`);
    console.log('🔄 正在回滚文件改动...');

    fs.writeFileSync(ARTICLES_PATH, backups.articles, 'utf-8');
    fs.writeFileSync(QUEUE_PATH, backups.queue, 'utf-8');
    fs.writeFileSync(SITEMAP_PATH, backups.sitemap, 'utf-8');

    // 删除可能已生成的 HTML 文件
    if (fs.existsSync(htmlPath)) {
      fs.unlinkSync(htmlPath);
    }

    console.log('✅ 回滚完成，所有文件恢复到原始状态');
    process.exit(1);
  }
}

// ============================================================
// Prompt 构建 — 意图感知 + 语义去重 + 自适应长度
// ============================================================

function buildMainPrompt(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap, sourceUrls) {
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;
  const verifiedNotes = sourceUrls
    .map(url => SOURCE_NOTES.get(url))
    .filter(Boolean)
    .map(note => `- ${note}`)
    .join('\n');

  // 构建已有文章摘要（标题 + 描述，让 AI 知道哪些话题已覆盖）
  const existingList = existingArticles
    .map(a => `- /blog/${a.slug}.html — "${a.titleEn}" — ${a.descEn || ''}`)
    .join('\n');

  // 构建「必须避开」指令
  let avoidSection = '';
  if (avoidOverlap.length > 0) {
    const avoidDetails = avoidOverlap.map(slug => {
      const existing = existingArticles.find(a => a.slug === slug);
      return existing
        ? `  - "${existing.titleEn}" (/blog/${slug}.html): ${existing.descEn}`
        : `  - /blog/${slug}.html`;
    }).join('\n');
    avoidSection = `
=== CRITICAL: AVOID OVERLAP ===
The following articles ALREADY EXIST on our site and cover similar ground.
Your article MUST provide DIFFERENT, UNIQUE value. Do NOT repeat the same advice.
Focus on what makes "${keyword}" DISTINCT from these:
${avoidDetails}
`;
  }

  // 根据搜索意图调整写作指令
  const intentGuide = {
    'informational': `Write an educational article that explains the concept clearly.
Structure: Definition → Why it matters → How it works → Best practices → Conclusion.
Tone: Teacher explaining to a student. Include clear examples.`,

    'how-to': `Write a step-by-step tutorial that the reader can follow immediately.
Structure: Brief intro → Prerequisites (if any) → Numbered steps → Common pitfalls → Conclusion.
Tone: Friendly instructor. Every step must be actionable with code or clear UI instructions.`,

    'comparison': `Write a balanced, factual comparison article.
Structure: Brief intro → Comparison table → When to use each option → Recommendation → Conclusion.
Tone: Objective analyst. Use a comparison table with clear criteria.`,

    'troubleshooting': `Write a problem-solving article that helps someone fix an issue quickly.
Structure: Symptom description → Quick fix (first) → Root causes explained → Prevention tips → Conclusion.
Tone: Helpful support engineer. Put the most common fix first (people are in a hurry).`,

    'tool-guide': `Write a practical guide about using a tool or platform feature.
Structure: What the tool does → Getting started → Key features → Pro tips → Conclusion.
Tone: Product guide writer. Focus on practical outcomes, not theory.`,
  };

  const writingStyle = intentGuide[intent] || intentGuide['informational'];

  return `You are a careful technical editor writing for Mzu favicondl (https://favicondl.com), a favicon download and conversion tool. Write naturally, but never invent personal experience, tests, customer stories, quotes, or measurements.

TARGET KEYWORD: "${keyword}"
SEARCH INTENT: ${intent}
TARGET LENGTH: ${depthCfg.minWords}-${depthCfg.maxWords} English words (strict)

=== WRITING STYLE ===
${writingStyle}

=== ⚠️ ANTI-AI RULES — READ THIS FIRST ===
Your writing MUST feel like a knowledgeable developer explaining a real problem, without pretending the author personally ran tests that were not provided.
The following phrases and patterns are STRICTLY BANNED. If you use them, the article fails:

BANNED OPENINGS (never start an article with these):
- "In today's digital landscape/world/era..."
- "When it comes to..."
- "In the ever-evolving world of..."
- "[Topic] is a crucial/essential/vital part of..."
- "[Topic] plays a key/important role in..."
- "Whether you're a beginner or expert..."

BANNED FILLER PHRASES (never use anywhere):
- "It's important to note that..."
- "It's worth mentioning that..."
- "It goes without saying..."
- "This comprehensive guide will..."
- "Let's dive in / Let's explore / Let's take a look"
- "Without further ado"
- "First and foremost"
- "Last but not least"
- "At the end of the day"
- "In conclusion" (just conclude naturally)

REQUIRED INSTEAD:
- Start with a SPECIFIC scenario, question, or surprising fact. Example: "If you've ever wondered why your site looks professional on desktop but shows a blank white square in Safari's tab bar — your favicon setup is probably incomplete."
- Use "we" / "you" naturally, like talking to a colleague.
- Use a real platform example only when it is observable or supported by a first-party source link.
- Give a clear recommendation when the evidence supports one, and state limits or trade-offs.
- Use SHORT paragraphs (2-3 sentences max). Long blocks of text are unreadable.
- Use occasional casual asides in parentheses (like this — they feel human).
- Every paragraph must teach something SPECIFIC the reader didn't know. No padding.

=== BRAND VOICE ===
- Like Apple docs meets a dev blog post. Clean, confident, opinionated.
- Audience: web developers and designers, all levels.
- NEVER use hype words ("amazing", "revolutionary", "game-changer", "unlock", "supercharge").
- Do not promote competing favicon-download tools. Browser vendors, web platforms, and standards bodies may be named when they are relevant sources.
- Brand: always "Mzu favicondl" (lowercase "favicondl").
- Date volatile requirements, prices, rankings, or product behavior. Do not add "2026" merely to make a claim sound current.

=== EVIDENCE RULES ===
- Never invent statistics, conversion effects, customer quotes, testimonials, rankings, or benchmark results.
- For current Google Search, browser, framework, or platform requirements, link to a first-party documentation page near the claim.
- Distinguish a documented requirement from a recommendation or opinion.
- If a fact cannot be verified from a supplied or first-party source, omit it or phrase it as a limited recommendation.

=== APPROVED FIRST-PARTY SOURCES ===
Use the following exact URLs for current platform, framework, browser, or search behavior. Link each relevant claim to its source. Do not invent replacement URLs.
${sourceUrls.map(url => `- ${url}`).join('\n')}

=== VERIFIED SOURCE NOTES ===
These notes were checked against the approved sources. Do not contradict them or turn a recommendation into a requirement.
${verifiedNotes || '- No additional source notes are configured; keep claims limited to what the linked documentation states.'}

=== CONTENT UNIQUENESS ===
These articles ALREADY EXIST on our blog. Do NOT repeat their content. Link to them instead.
${existingList}
${avoidSection}
=== SEO (2026) ===
- Google uses semantic understanding. Don't stuff the exact keyword.
- Include the keyword naturally in: the title, the opening paragraph, and at least one <h2>.
- Use semantic variations throughout.
- Title: 50-60 chars. Description: 140-160 chars.
- meta keywords: 3-5 terms. MUST BE UNDER 90 CHARACTERS.

=== HTML RULES ===
- 🛠️ CRITICAL: You MUST use single quotes for all HTML attributes (e.g., <a href='/link' class='btn'>). Do NOT use double quotes. This is mandatory to prevent breaking the JSON string escaping.
- <h2> for sections, <h3> for sub-sections. NEVER <h1>.
- <p> for paragraphs. <strong> for key terms. <code> for inline code.
- Code blocks: <pre><code>...</code></pre>.
- Inside <code> and <pre>, escape markup characters as &amp;lt; and &amp;gt;. Raw <link>, <meta>, or other page tags inside a code example are invalid.
- Tables: <table><thead>...<tbody>...</table>.
- Internal links: relative paths (/blog/xxx.html). Link to 1-2 existing articles.
- FORBIDDEN: <script>, <style>, <iframe>, <form>, <input>, <h1>, <meta>, <img>.
- HTML only, no markdown.

=== 🏆 QUALITY SCORING CRITERIA (MANDATORY) ===
Your article will be graded automatically. Match the structure to the search intent instead of filling a template:
1. LONG FORM CONTENT: The English version MUST exceed the minimum word count specified above. Expand on examples, case studies, and common pitfalls to ensure depth.
2. CODE EXAMPLES: Include a code block for how-to, troubleshooting, or implementation topics. Do not force code into a design or conceptual article.
3. SUB-SECTIONS: Use headings that answer the reader's actual questions; do not add repetitive sections merely to increase a score.
4. LISTS: You MUST include at least one bulleted list \`<ul>\` or numbered list \`<ol>\` to organize steps or features.
5. INTERNAL LINKS: You MUST include 1 or 2 internal links (e.g., \`<a href='/blog/example.html'>\`) using the existing articles provided above.

=== MULTI-LANGUAGE METADATA (titles, descriptions, breadcrumbs, CTA) ===
Provide metadata for ALL 5 languages (en, zh, ja, ko, es). These are SHORT fields — NOT the full article body.
- titleZh/Ja/Ko/Es: Highly optimized, native-sounding titles. Use local search habits.
- descZh/Ja/Ko/Es: Compelling meta descriptions adapted for each language.
- breadcrumbZh/Ja/Ko/Es: Native breadcrumb labels.
- ctaTitleZh/Ja/Ko/Es, ctaDescZh/Ja/Ko/Es, ctaBtnZh/Ja/Ko/Es: Native, persuasive CTA copy.
- Keep technical terms (favicon, ICO, PNG, SVG) in English.
- Japanese: use です/ます style. Korean: use 합니다 style. Spanish: use "tú" form.
- Chinese: no 套话 like "在当今数字化时代", "众所周知", "不言而喻".

NOTE: The full article body for zh/ja/ko/es will be generated separately in follow-up calls. Only provide the English article body (contentEn) here.

=== OUTPUT FORMAT ===
Return ONLY valid JSON.
CRITICAL: Do NOT use literal newlines inside string values. Export strings as single continuous lines and use \n for line breaks. Do NOT leave unescaped double quotes inside strings.

{
  "titleEn": "Engaging title with keyword (50-60 chars)",
  "titleZh": "自然的中文标题",
  "titleJa": "日本語タイトル",
  "titleKo": "한국어 제목",
  "titleEs": "Título en español",
  "descEn": "Meta description (140-160 chars)",
  "descZh": "中文描述",
  "descJa": "日本語の説明",
  "descKo": "한국어 설명",
  "descEs": "Descripción en español",
  "metaKeywords": "keyword1, keyword2, ...",
  "breadcrumbEn": "Short Breadcrumb",
  "breadcrumbZh": "中文面包屑",
  "breadcrumbJa": "パンくず",
  "breadcrumbKo": "브레드크럼",
  "breadcrumbEs": "Migas de pan",
  "contentEn": "<p>HTML article body...</p>",
  "ctaTitleEn": "CTA heading",
  "ctaTitleZh": "CTA 标题",
  "ctaTitleJa": "CTA 見出し",
  "ctaTitleKo": "CTA 제목",
  "ctaTitleEs": "Título CTA",
  "ctaDescEn": "CTA description",
  "ctaDescZh": "CTA 描述",
  "ctaDescJa": "CTA 説明",
  "ctaDescKo": "CTA 설명",
  "ctaDescEs": "Descripción CTA",
  "ctaBtnEn": "Try It Free →",
  "ctaBtnZh": "免费试用 →",
  "ctaBtnJa": "無料で試す →",
  "ctaBtnKo": "무료로 사용해보기 →",
  "ctaBtnEs": "Pruébalo gratis →",
  "ctaLink": "/index.html"
}`;
}

// ============================================================
// 翻译 Prompt — 根据英文正文生成单语言内容（文化适配，非直译）
// ============================================================

function buildTranslationPrompt(englishContent, englishTitle, langCode, keyword) {
  const langMap = {
    Zh: {
      name: 'Chinese',
      nativeName: '中文',
      rules: '- Write natural Chinese rather than mechanically mirroring English syntax.\n- Localize idioms and explanations, but preserve every factual example, qualification, and source. Keep technical terms in English where that is clearer.\n- Apply the same anti-AI writing rules: no 套话 like "在当今数字化时代", "众所周知", "不言而喻". Write like a careful Chinese developer, not a textbook.',
    },
    Ja: {
      name: 'Japanese',
      nativeName: '日本語',
      rules: '- Japanese: use です/ます style and a natural technical-editor tone.\n- Localize explanations, but preserve every factual example, qualification, and source. Keep technical terms in English where that is clearer.\n- No AI clichés.',
    },
    Ko: {
      name: 'Korean',
      nativeName: '한국어',
      rules: '- Korean: use 합니다 style and a natural technical-editor tone.\n- Localize explanations, but preserve every factual example, qualification, and source. Keep technical terms in English where that is clearer.\n- No AI clichés.',
    },
    Es: {
      name: 'Spanish',
      nativeName: 'español',
      rules: '- Spanish: use "tú" form and a natural technical-editor tone.\n- Localize explanations, but preserve every factual example, qualification, and source. Keep technical terms in English where that is clearer.\n- No AI clichés.',
    },
  };

  const lang = langMap[langCode];
  if (!lang) throw new Error(`未知语言代码: ${langCode}`);

  return `You are a professional ${lang.name} tech blogger. Adapt the following English article into ${lang.nativeName}.
CRITICAL: This is not a word-for-word translation. Produce fluent native-language prose while keeping the source article's meaning, evidence, and limitations intact.

=== ADAPTATION RULES ===
${lang.rules}
- You may rephrase the introduction for fluency, but do not replace named examples with regional brands or invent local examples.
- Preserve factual claims, dates, measurements, source URLs, uncertainty, and requirement-versus-recommendation distinctions.
- Do not add statistics, tests, customer stories, rankings, platform requirements, or product claims that are absent from the English source.
- Keep first-party citations adjacent to the claim they support.
- Structure can vary slightly only when required for natural grammar; do not add or remove substantive sections.
- Keep ALL HTML tags and structure (h2, h3, p, ul, li, pre, code, a, strong, em, table, etc.)
- Keep all href links unchanged
- Keep technical terms in English: favicon, ICO, PNG, SVG, CSS, HTML, JavaScript, PWA, CDN, CORS, API, etc.
- Do NOT add new tags or remove existing ones
- Do NOT translate code inside <pre><code> blocks
- Keep markup shown inside <code> or <pre> escaped as &amp;lt; and &amp;gt;; never turn it into live page-level HTML.
- HTML only, no markdown

=== HTML RULES ===
- Use single quotes for all HTML attributes (e.g., <a href='/link' class='btn'>).
- Do NOT use double quotes in HTML attributes.

=== OUTPUT FORMAT ===
Return ONLY valid JSON.
CRITICAL: Do NOT use literal newlines inside string values. Use \\n for line breaks. Do NOT leave unescaped double quotes inside strings.

{
  "content": "<p>${lang.nativeName} HTML article body...</p>"
}

=== ENGLISH ARTICLE TO ADAPT ===
Title: ${englishTitle}

${englishContent}`;
}

// ============================================================
// AI 调用 — 单次调用带重试和多模型降级
// ============================================================

function getErrorStatus(error) {
  return Number(error?.status || error?.response?.status || 0);
}

function isJsonModeUnsupported(error) {
  return getErrorStatus(error) === 400 && /response[_ -]?format|json[_ -]?object|structured output/i.test(error?.message || '');
}

function classifyModelError(error) {
  const status = getErrorStatus(error);
  const message = error?.message || '';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 410 || status === 400) return 'permanent';
  if (status === 429 || status >= 500 || /quota|RESOURCE_EXHAUSTED|high demand/i.test(message)) return 'transient';
  if (/AbortError|aborted|超时|timeout/i.test(message)) return 'timeout';
  if (/Connection|ECONNRESET|socket|network|fetch/i.test(message)) return 'transient';
  if (error?.code === 'INVALID_MODEL_OUTPUT') return 'retryable-output';
  if (/JSON|空响应/i.test(message)) return 'retryable-output';
  return 'unknown';
}

function requireStringFields(data, fields, label = '模型输出') {
  const missing = fields.filter(field => typeof data?.[field] !== 'string' || !data[field].trim());
  if (missing.length > 0) {
    const error = new Error(`${label}缺少必需字段: ${missing.join(', ')}`);
    error.code = 'INVALID_MODEL_OUTPUT';
    throw error;
  }
  return data;
}

async function requestModel(modelName, prompt, temperature, useJsonMode = true, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`API 调用超时(${Math.round(timeoutMs / 1000)}s)`)), timeoutMs);
  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: 'You are a professional multilingual technical editor. Return valid JSON only when asked.' },
      { role: 'user', content: prompt },
    ],
    temperature,
    top_p: 0.95,
    max_tokens: 16384,
    ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
  try {
    return await ai.chat.completions.create(payload, { signal: controller.signal });
  } catch (error) {
    if (useJsonMode && isJsonModeUnsupported(error)) {
      console.log(`  ℹ️ ${modelName} 不支持 response_format，改用提示词 JSON 模式重试`);
      return await ai.chat.completions.create({ ...payload, response_format: undefined }, { signal: controller.signal });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callAI(prompt, label, temperature = 0.55, models = ARTICLE_MODELS, timeoutMs = API_TIMEOUT_MS, validateResponse = null) {
  let lastError;
  for (const modelName of models) {
    if (disabledModels.has(modelName)) {
      console.log(`  ↪ [${label}] 跳过本轮已熔断模型 ${modelName}`);
      continue;
    }
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`  → [${label}] 模型 ${modelName} (第 ${attempt}/${MAX_RETRIES} 次)...`);
        const result = await requestModel(modelName, prompt, temperature, true, timeoutMs);
        const responseText = result.choices?.[0]?.message?.content;
        if (!responseText || responseText.trim() === '') {
          throw new Error('API 返回了空响应');
        }
        const data = parseAIResponse(responseText);
        if (validateResponse) validateResponse(data);
        console.log(`  ✅ [${label}] ${modelName} 响应成功 (${responseText.length} 字符)`);
        return data;
      } catch (error) {
        lastError = error;
        const kind = classifyModelError(error);
        const status = getErrorStatus(error);
        const summary = status ? `HTTP ${status}` : (error.message || '未知错误').substring(0, 120);
        console.log(`  ⚠️ [${label}] ${modelName} 失败: ${summary}`);

        if (kind === 'auth') throw new Error(`NVIDIA API 鉴权失败 (${summary})`);
        if (kind === 'permanent') {
          disabledModels.add(modelName);
          console.log(`  ⛔ ${modelName} 本轮熔断，后续语言任务不再重复调用`);
          break;
        }
        if (kind === 'timeout') {
          disabledModels.add(modelName);
          console.log(`  ⛔ ${modelName} 本轮超时熔断，后续语言任务改用其他模型`);
          break;
        }
        if (attempt < MAX_RETRIES && ['transient', 'retryable-output', 'unknown'].includes(kind)) {
          const delay = kind === 'transient' ? RETRY_DELAY_MS : 3000;
          console.log(`  ⏳ 等待 ${delay / 1000} 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }
  }

  throw new Error(`[${label}] 所有模型均调用失败${lastError?.message ? `：${lastError.message}` : ''}`);
}

// ============================================================
// AI 调用 — 英文主文 + 四次短翻译（避免单次超大输出超时）
// ============================================================

const MAIN_REQUIRED_FIELDS = REQUIRED_FIELDS.filter(field => !['contentZh', 'contentJa', 'contentKo', 'contentEs'].includes(field));

async function repairMissingMetadata(data, keyword) {
  if (!data.contentEn || !data.titleEn) {
    throw new Error('英文主输出缺少 titleEn 或 contentEn，不能安全地局部修复');
  }
  if (!data.ctaLink) data.ctaLink = '/index.html';
  const missing = MAIN_REQUIRED_FIELDS.filter(field => !data[field] || (typeof data[field] === 'string' && !data[field].trim()));
  if (missing.length === 0) return data;

  console.log(`  🔧 检测到可局部修复的元数据字段: ${missing.join(', ')}`);
  const context = Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'contentEn'));
  const repairPrompt = `Repair only the missing metadata fields for a multilingual favicon article.
Topic: ${keyword}
English title: ${data.titleEn}
English description: ${data.descEn || ''}
Missing fields: ${missing.join(', ')}
Existing metadata: ${JSON.stringify(context)}

Return one valid JSON object containing exactly the missing fields. Keep titles concise, descriptions natural and search-friendly, and CTA copy factual. Do not return article HTML.`;
  const repaired = await callAI(
    repairPrompt,
    'metadata-repair',
    0.2,
    ARTICLE_MODELS,
    API_TIMEOUT_MS,
    candidate => requireStringFields(candidate, missing, '元数据修复输出'),
  );
  for (const field of missing) {
    if (typeof repaired[field] === 'string' && repaired[field].trim()) data[field] = repaired[field].trim();
  }
  const remaining = MAIN_REQUIRED_FIELDS.filter(field => !data[field] || (typeof data[field] === 'string' && !data[field].trim()));
  if (remaining.length > 0) throw new Error(`元数据局部修复后仍缺少: ${remaining.join(', ')}`);
  return data;
}

function normalizeDescription(value, maxLength = 160) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  const candidate = compact.slice(0, maxLength - 1);
  const sentenceBoundary = Math.max(candidate.lastIndexOf('. '), candidate.lastIndexOf('! '), candidate.lastIndexOf('? '));
  const wordBoundary = candidate.lastIndexOf(' ');
  const cutAt = sentenceBoundary >= 100 ? sentenceBoundary + 1 : wordBoundary;
  const shortened = candidate.slice(0, cutAt > 0 ? cutAt : maxLength - 1).replace(/[\s,;:\-]+$/g, '');
  return /[.!?]$/.test(shortened) ? shortened : `${shortened}.`;
}

function ensureFirstPartyEvidence(data, sourceUrls) {
  data.descEn = normalizeDescription(data.descEn);
  const specificallyRequired = sourceUrls.filter(url => url !== GENERAL_FAVICON_SOURCE);
  const requiredSources = specificallyRequired.length > 0 ? specificallyRequired : sourceUrls;
  const missingSources = requiredSources.filter(url => !String(data.contentEn || '').includes(url));
  if (missingSources.length === 0) return data;

  const evidenceParagraphs = missingSources.map(url => {
    const supportedStatement = SOURCE_EVIDENCE.get(url);
    if (!supportedStatement) {
      throw new Error(`没有为必需的一方来源配置可验证摘要: ${url}`);
    }
    return `<p>${supportedStatement}</p>`;
  });
  const evidenceSection = `<h2>Check the documented requirements</h2>${evidenceParagraphs.join('')}`;
  data.contentEn = `${String(data.contentEn || '').trim()}${evidenceSection}`;
  console.log(`  🔗 已补入 ${missingSources.length} 个缺失的一方来源，并让后续翻译以修复后的英文正文为准`);
  return data;
}

function validateKnownPlatformClaims(data, keyword = '') {
  const html = String(data?.contentEn || '');
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const topic = `${keyword} ${data?.titleEn || ''} ${plain}`;
  const problems = [];

  if (/google|search results?/i.test(topic)) {
    if (/google[^.]{0,120}(?:requires?|minimum(?: size)?(?: is| of)?)[^.]{0,35}48\s*[x×]\s*48/i.test(plain)
        || /google[^.]{0,120}at least\s+48\s*[x×]\s*48/i.test(plain)
        || /48\s*[x×]\s*48[^.]{0,45}(?:minimum|required)[^.]{0,70}google/i.test(plain)) {
      problems.push('把 48×48 错写成 Google 最低要求（最低为 8×8，建议大于 48×48）');
    }
    if (/(?:appear|display|restore)[^.]{0,60}(?:within|in)\s+(?:a few\s+)?minutes/i.test(plain)) {
      problems.push('承诺 Google favicon 在几分钟内显示');
    }
    if (/(?:append|add|use)[^.]{0,100}(?:cache[- ]bust|query string|\?v=)/i.test(plain)) {
      problems.push('建议频繁改变 Google 要求保持稳定的 favicon URL');
    }
  }

  if (/\bwix\b/i.test(topic)
      && (/(?:go to|open|navigate to)[^.]{0,120}custom code/i.test(plain)
          || /custom code[^.]{0,100}(?:paste|add)[^.]{0,80}(?:head|rel=.icon)/i.test(plain))) {
    problems.push('把 Wix Custom Code 错写成常规 favicon 设置路径');
  }

  if (problems.length > 0) {
    const error = new Error(`平台事实校验失败: ${problems.join('；')}`);
    error.code = 'INVALID_MODEL_OUTPUT';
    throw error;
  }
  return data;
}

async function generateArticleContent(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap, sourceUrls) {
  // --- 第 1 步：生成英文正文 + 5 语言元数据 ---
  const mainPrompt = buildMainPrompt(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap, sourceUrls);
  console.log('🤖 [1/5] 正在调用 NVIDIA NIM API 生成英文文章 + 元数据...');
  const data = ensureFirstPartyEvidence(
    await repairMissingMetadata(await callAI(
      mainPrompt,
      'main',
      0.55,
      ARTICLE_MODELS,
      API_TIMEOUT_MS,
      candidate => {
        requireStringFields(candidate, ['titleEn', 'contentEn'], '英文主输出');
        validateKnownPlatformClaims(candidate, keyword);
      },
    ), keyword),
    sourceUrls,
  );
  console.log(`✅ 英文文章生成完成: "${data.titleEn}"`);

  // --- 第 2-5 步：每次只生成一个语言，避免四语大响应超过免费端点时限 ---
  const languages = [
    { code: 'Zh', name: '中文' },
    { code: 'Ja', name: '日本語' },
    { code: 'Ko', name: '한국어' },
    { code: 'Es', name: 'Español' },
  ];
  for (let index = 0; index < languages.length; index++) {
    const lang = languages[index];
    console.log(`\n🌐 [${index + 2}/5] 正在生成${lang.name}正文...`);
    const translationPrompt = buildTranslationPrompt(data.contentEn, data.titleEn, lang.code, keyword);
    const translation = await callAI(
      translationPrompt,
      `translate-${lang.code}`,
      0.45,
      TRANSLATION_MODELS,
      TRANSLATION_API_TIMEOUT_MS,
      candidate => {
        requireStringFields(candidate, ['content'], `${lang.name}翻译输出`);
        const repairedContent = escapeUnexpectedHtmlTags(candidate.content);
        if (repairedContent !== candidate.content) {
          console.log(`  🔧 [translate-${lang.code}] 已将误生成的未知 HTML 标签转回可见文本`);
          candidate.content = repairedContent;
        }
        validateTranslationContent(data.contentEn, candidate.content, `${lang.name}翻译输出`);
      },
    );
    data[`content${lang.code}`] = translation.content;
    console.log(`  ✅ ${lang.name}正文生成完成 (${translation.content.length} 字符)`);
    if (index < languages.length - 1) await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // --- 验证完整数据 ---
  validateArticleData(data, keyword, depth, sourceUrls);
  console.log(`✅ 全部生成完成: "${data.titleEn}"`);
  return data;
}

// ============================================================
// AI 响应解析 — 健壮的 JSON 提取
// ============================================================

// 修复被截断的 JSON — 当 AI 输出因 max_tokens 不足被切断时
// 策略：找到最后一个完整的 "key": "value" 对，截断其后内容，补全引号和大括号
function repairTruncatedJSON(text) {
  let s = text.trim();

  // 如果已经有完整的 }，不需要修复
  if (s.endsWith('}')) return null;

  // 找到最后一个完整的引号闭合位置（即最后一个 ": "..." 的结尾）
  // 从后往前找，定位最后一个完整的值字符串的结束引号
  let lastCompleteQuote = -1;
  let inStr = false;
  let escaped = false;
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      if (!inStr) {
        // 字符串刚闭合
        lastCompleteQuote = i;
      }
    } else if (!inStr) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
  }

  if (lastCompleteQuote === -1) return null;

  // 截断到最后一个完整值之后，可能还需要处理逗号
  let cut = s.substring(0, lastCompleteQuote + 1).trimEnd();
  // 移除可能的尾随逗号
  if (cut.endsWith(',')) cut = cut.slice(0, -1);

  // 补全缺失的闭合大括号（根据嵌套深度）
  // 重新计算截断后的深度
  depth = 0;
  inStr = false;
  escaped = false;
  for (let i = 0; i < cut.length; i++) {
    const ch = cut[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
    }
  }

  // 补全所有未闭合的大括号
  while (depth > 0) {
    cut += '}';
    depth--;
  }

  try {
    return JSON.parse(cut);
  } catch (e) {
    return null;
  }
}

function parseAIResponse(responseText) {
  let cleaned = responseText.trim();

  // 移除 markdown 代码块标记（AI 可能会加上）
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 尝试直接修复 JSON 字符串中常见的特殊字符（例如字面量换行符）
    let fixed = '';
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (escapeNext) {
        fixed += char;
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
        fixed += char;
      } else if (char === '"') {
        inString = !inString;
        fixed += char;
      } else if (inString && char === '\n') {
        fixed += '\\n';
      } else if (inString && char === '\r') {
        fixed += '\\r';
      } else if (inString && char === '\t') {
        fixed += '\\t';
      } else {
        fixed += char;
      }
    }

    try {
      return JSON.parse(fixed);
    } catch (e2) {
      // 如果还失败，尝试提取首尾大括号
      const firstBrace = fixed.indexOf('{');
      const lastBrace = fixed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        const extracted = fixed.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(extracted);
        } catch (e3) {
          console.error('❌ JSON 提取解析失败:', e3.message);
        }
      }

      // 尝试修复被截断的 JSON（AI 输出因 max_tokens 不足被切断）
      // 策略：找到最后一个完整的键值对，截断其后内容，补全引号和大括号
      if (firstBrace !== -1) {
        const truncated = fixed.substring(firstBrace);
        try {
          const repaired = repairTruncatedJSON(truncated);
          if (repaired) {
            console.log('  🔧 检测到 JSON 可能被截断，尝试自动修复...');
            return repaired;
          }
        } catch (e4) {
          console.error('❌ JSON 截断修复失败:', e4.message);
        }
      }

      console.error('❌ JSON 解析失败 (首次尝试):', e.message);
      console.error('❌ JSON 解析失败 (修复尝试):', e2.message);
      console.error('AI 原始输出 (前 800 字符):');
      console.error(cleaned.substring(0, 800));
      if (cleaned.length > 800) {
        console.error('...AI 原始输出 (末尾 800 字符):');
        console.error(cleaned.substring(cleaned.length - 800));
      }

      try {
        const debugFile = path.join(BLOG_DIR, 'failed_response_debug.txt');
        fs.writeFileSync(debugFile, responseText, 'utf-8');
        console.error(`已将完整错误响应写入到: ${debugFile}`);
      } catch (ex) { /* ignore */ }

      throw new Error('AI 返回了无效的 JSON，请重试');
    }
  }
}

// ============================================================
// 内容验证 — 多维度质量检查
// ============================================================

function validateHtmlFragment(html, label, errors) {
  if (!html) return;

  if (/&lt;\/?(?:p|h2|h3|ul|ol|li|pre|code|a|table|tr|td|th)\b/i.test(html)) {
    errors.push(`${label} 包含被转义的结构标签，正文可能已损坏`);
  }
  if (/```|`<\/?(?:p|h2|h3|pre|code|a|table)\b/i.test(html)) {
    errors.push(`${label} 混入 Markdown 代码围栏或反引号 HTML`);
  }

  const stack = [];
  const tagPattern = /<\/?([a-z0-9-]+)\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const fullTag = match[0];
    const tag = match[1].toLowerCase();
    if (!ALLOWED_CONTENT_TAGS.has(tag)) {
      errors.push(`${label} 包含不允许的正文标签: <${tag}>；代码示例中的尖括号必须写成 &lt; 和 &gt;`);
      continue;
    }
    if (VOID_CONTENT_TAGS.has(tag)) continue;
    if (fullTag.startsWith('</')) {
      const expected = stack.pop();
      if (expected !== tag) {
        errors.push(`${label} HTML 标签闭合错误: 期望 </${expected || 'none'}>，实际为 </${tag}>`);
        return;
      }
    } else if (!fullTag.endsWith('/>')) {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    errors.push(`${label} 存在未闭合标签: ${stack.map(tag => `<${tag}>`).join(', ')}`);
  }

  for (const anchor of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attributes = anchor[1];
    const href = attributes.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (!href || href === '#') errors.push(`${label} 包含空链接或占位链接`);
    if (href && /^javascript:/i.test(href)) errors.push(`${label} 包含 javascript: 链接`);
  }
  if (/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/i.test(html)) {
    errors.push(`${label} 包含嵌套链接`);
  }
}

function validateArticleData(data, keyword, depth, sourceUrls = []) {
  console.log('\n🔍 正在验证文章质量...');
  const errors = [];
  const warnings = [];
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;

  // --- 1. 必填字段完整性 ---
  for (const field of REQUIRED_FIELDS) {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      errors.push(`缺少必填字段: ${field}`);
    }
  }

  // --- 2. 标题长度 ---
  if (data.titleEn && (data.titleEn.length < 20 || data.titleEn.length > 80)) {
    warnings.push(`英文标题 ${data.titleEn.length} 字符（建议 50-60）`);
  }

  // --- 3. Meta 描述长度 ---
  if (data.descEn && (data.descEn.length < 80 || data.descEn.length > 200)) {
    warnings.push(`英文描述 ${data.descEn.length} 字符（建议 140-160）`);
  }

  // --- 4. 英文词数检查（基于 depth） ---
  if (data.contentEn) {
    const plainText = data.contentEn.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = plainText.split(' ').filter(w => w.length > 0).length;
    console.log(`  📏 英文词数: ${wordCount} (目标: ${depthCfg.minWords}-${depthCfg.maxWords})`);

    // 允许 20% 浮动
    const softMin = Math.floor(depthCfg.minWords * 0.8);
    const softMax = Math.ceil(depthCfg.maxWords * 1.2);
    if (wordCount < softMin) {
      errors.push(`英文内容太短: ${wordCount} 词 (最少 ${softMin})`);
    } else if (wordCount > softMax) {
      warnings.push(`英文内容偏长: ${wordCount} 词 (目标上限 ${depthCfg.maxWords})`);
    }
  }

  // --- 5. 中文内容长度（按英文词数的 0.6 倍估算字数） ---
  if (data.contentZh) {
    const zhPlain = data.contentZh.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    const zhCharCount = zhPlain.length;
    const minZhChars = Math.floor(depthCfg.minWords * 0.6);
    console.log(`  📏 中文字数: ${zhCharCount} (最少 ${minZhChars})`);
    if (zhCharCount < minZhChars) {
      errors.push(`中文内容太短: ${zhCharCount} 字 (最少 ${minZhChars})`);
    }
  }

  // --- 6. 语义关键词位置检查（现代 SEO：位置 > 密度） ---
  if (data.contentEn && data.titleEn) {
    const kwLower = keyword.toLowerCase();
    const kwWords = kwLower.split(' ').filter(w => w.length > 2); // 忽略短词（to, a, of）

    // 检查标题是否包含关键词（或其核心词）
    const titleLower = data.titleEn.toLowerCase();
    const titleHasKw = kwWords.some(w => titleLower.includes(w));
    if (titleHasKw) {
      console.log(`  ✅ 标题包含关键词核心词`);
    } else {
      warnings.push(`标题可能未包含关键词 "${keyword}" 的核心词汇`);
    }

    // 检查第一段是否包含关键词
    const firstPMatch = data.contentEn.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (firstPMatch) {
      const firstP = firstPMatch[1].toLowerCase().replace(/<[^>]+>/g, '');
      const firstPHasKw = kwWords.filter(w => w.length > 3).some(w => firstP.includes(w));
      if (firstPHasKw) {
        console.log(`  ✅ 首段包含关键词`);
      } else {
        warnings.push(`首段建议包含 "${keyword}" 的语义相关词`);
      }
    }

    // 检查 H2 是否包含关键词（至少一个）
    const h2Matches = data.contentEn.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi) || [];
    const h2HasKw = h2Matches.some(h2 => {
      const h2Text = h2.toLowerCase().replace(/<[^>]+>/g, '');
      return kwWords.filter(w => w.length > 3).some(w => h2Text.includes(w));
    });
    if (h2HasKw) {
      console.log(`  ✅ 至少一个 H2 包含关键词`);
    } else {
      warnings.push(`建议至少一个 <h2> 包含 "${keyword}" 相关词`);
    }
  }

  // --- 7. CTA 链接白名单 ---
  if (data.ctaLink && !VALID_CTA_LINKS.includes(data.ctaLink)) {
    warnings.push(`CTA 链接 "${data.ctaLink}" 已自动修正为 /index.html`);
    data.ctaLink = '/index.html';
  }

  // --- 8. 禁止标签检查 ---
  const allContent = (data.contentEn || '') + (data.contentZh || '') + (data.contentJa || '') + (data.contentKo || '') + (data.contentEs || '');
  for (const tag of FORBIDDEN_TAGS) {
    if (new RegExp(`<${tag}[\\s>]`, 'i').test(allContent)) {
      errors.push(`内容包含禁止标签: <${tag}>`);
    }
  }

  // --- 9. HTML 基本结构（所有语言都必须是可解析、单一正文） ---
  const contentByLanguage = [
    ['英文', data.contentEn],
    ['中文', data.contentZh],
    ['日文', data.contentJa],
    ['韩文', data.contentKo],
    ['西班牙文', data.contentEs],
  ];
  for (const [label, content] of contentByLanguage) {
    validateHtmlFragment(content, label, errors);
    if (content && !/<h2[\s>]/i.test(content)) warnings.push(`${label}内容缺少 <h2>`);
    if (content && !/<p[\s>]/i.test(content)) errors.push(`${label}内容缺少 <p>`);
  }
  const platformClaim = /\b(?:Google|Chrome|Safari|Firefox|Apple|Microsoft|Edge|WordPress|Shopify|Wix|Squarespace)\b/i.test(data.contentEn || '');
  const externalSourceLinks = [...(data.contentEn || '').matchAll(/<a\s+[^>]*href\s*=\s*(['"])(https:\/\/[^'"]+)\1/gi)]
    .map(match => match[2]);
  const officialSourceHosts = [
    'developers.google.com', 'web.dev', 'developer.chrome.com', 'developer.mozilla.org',
    'developer.apple.com', 'support.apple.com', 'learn.microsoft.com', 'wordpress.org',
    'shopify.dev', 'help.shopify.com', 'support.wix.com', 'support.squarespace.com',
    'w3.org', 'html.spec.whatwg.org'
  ];
  for (const sourceUrl of sourceUrls) {
    try {
      officialSourceHosts.push(new URL(sourceUrl).hostname.toLowerCase());
    } catch { /* invalid configured source is caught below */ }
  }
  const hasOfficialSource = externalSourceLinks.some(link => {
    try {
      const host = new URL(link).hostname.toLowerCase();
      return officialSourceHosts.some(officialHost => host === officialHost || host.endsWith(`.${officialHost}`));
    } catch {
      return false;
    }
  });
  if (platformClaim && !hasOfficialSource) {
    errors.push('英文正文包含当前平台或浏览器行为，但没有受支持的第一方来源链接');
  }
  const specificallyRequiredSources = sourceUrls.filter(url => url !== GENERAL_FAVICON_SOURCE);
  const requiredSources = specificallyRequiredSources.length > 0 ? specificallyRequiredSources : sourceUrls;
  const missingSources = requiredSources.filter(url => !(data.contentEn || '').includes(url));
  if (missingSources.length > 0) {
    errors.push(`英文正文没有引用配置的第一方来源: ${missingSources.join(', ')}`);
  }

  // --- 10. AI 套话检测（降低 AI 感） ---
  const AI_CLICHES_EN = [
    "in today's digital", "in the ever-evolving", "it's important to note",
    "it's worth mentioning", "without further ado", "let's dive in",
    "this comprehensive guide", "whether you're a beginner",
    "first and foremost", "last but not least", "at the end of the day",
    "plays a key role", "plays an important role", "crucial role",
    "it goes without saying", "let's explore", "let's take a look",
  ];
  const AI_CLICHES_ZH = [
    "在当今数字化时代", "众所周知", "不言而喻", "随着技术的不断发展",
    "本文将为您", "本篇文章将", "废话不多说",
  ];
  if (data.contentEn) {
    const enLower = data.contentEn.toLowerCase();
    const foundEn = AI_CLICHES_EN.filter(c => enLower.includes(c));
    if (foundEn.length > 0) {
      warnings.push(`检测到 AI 套话(英文): "${foundEn.join('", "')}"`);
    }
  }
  if (data.contentZh) {
    const foundZh = AI_CLICHES_ZH.filter(c => data.contentZh.includes(c));
    if (foundZh.length > 0) {
      warnings.push(`检测到 AI 套话(中文): "${foundZh.join('", "')}"`);
    }
  }

  // --- 11. 中文内容确实是中文 ---
  if (data.contentZh) {
    const zhChars = (data.contentZh.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = data.contentZh.replace(/<[^>]+>/g, '').length;
    const zhRatio = totalChars > 0 ? zhChars / totalChars : 0;
    if (zhRatio < 0.15) {
      errors.push(`中文字符比例仅 ${(zhRatio * 100).toFixed(1)}%`);
    } else {
      console.log(`  ✅ 中文比例: ${(zhRatio * 100).toFixed(1)}%`);
    }
  }

  // --- 输出 ---
  if (warnings.length > 0) {
    console.log('  ⚠️ 警告:');
    warnings.forEach(w => console.log(`     - ${w}`));
  }
  if (errors.length > 0) {
    console.log('  ❌ 错误:');
    errors.forEach(e => console.log(`     - ${e}`));
    throw new Error(`质量检查失败（${errors.length} 个错误）:\n${errors.join('\n')}`);
  }
  console.log('  ✅ 质量检查通过\n');
}

// ============================================================
// 文章质量评分 — 8 维度自动打分 (满分 100)
// ============================================================

function scoreArticleQuality(data, keyword, depth, intent) {
  console.log('\n📊 正在评估文章质量...');
  let score = 0;
  const details = [];
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;

  // --- 1. 英文词数是否在目标范围 (20分) ---
  if (data.contentEn) {
    const plainText = data.contentEn.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount = plainText.split(' ').filter(w => w.length > 0).length;
    if (wordCount >= depthCfg.minWords && wordCount <= depthCfg.maxWords) {
      score += 20;
      details.push('词数达标 +20');
    } else if (wordCount >= depthCfg.minWords * 0.8) {
      score += 12;
      details.push(`词数偏少(${wordCount}) +12`);
    } else {
      score += 5;
      details.push(`词数不足(${wordCount}) +5`);
    }
  }

  // --- 2. 代码是否符合搜索意图 (15分) ---
  if (data.contentEn) {
    const hasPre = /<pre[\s>]/i.test(data.contentEn);
    const hasCode = /<code[\s>]/i.test(data.contentEn);
    const codeExpected = ['how-to', 'troubleshooting', 'tool-guide'].includes(intent);
    if (hasPre) {
      score += 15;
      details.push('有代码块 +15');
    } else if (hasCode) {
      score += 8;
      details.push('有行内代码 +8');
    } else if (!codeExpected) {
      score += 15;
      details.push('当前搜索意图不需要强塞代码 +15');
    } else {
      details.push('操作型文章缺少代码示例 +0');
    }
  }

  // --- 3. FAQ / H3 小节数量 (15分) ---
  if (data.contentEn) {
    const h3Count = (data.contentEn.match(/<h3[\s>]/gi) || []).length;
    if (h3Count >= 3) {
      score += 15;
      details.push(`${h3Count}个H3小节 +15`);
    } else if (h3Count >= 1) {
      score += 7;
      details.push(`${h3Count}个H3小节 +7`);
    } else {
      details.push('无H3小节 +0');
    }
  }

  // --- 4. 内部链接数量 (10分) ---
  if (data.contentEn) {
    const internalLinks = (data.contentEn.match(/<a\s+[^>]*href=['"]\/blog\//gi) || []).length;
    if (internalLinks >= 2) {
      score += 10;
      details.push(`${internalLinks}条内链 +10`);
    } else if (internalLinks === 1) {
      score += 5;
      details.push('1条内链 +5');
    } else {
      details.push('无内链 +0');
    }
  }

  // --- 5. AI 套话命中数 (15分, 0命中=满分) ---
  if (data.contentEn) {
    const enLower = data.contentEn.toLowerCase();
    const AI_CLICHES = [
      "in today's digital", "in the ever-evolving", "it's important to note",
      "it's worth mentioning", "without further ado", "let's dive in",
      "this comprehensive guide", "whether you're a beginner",
      "first and foremost", "last but not least", "at the end of the day",
      "plays a key role", "plays an important role", "crucial role",
      "let's explore", "let's take a look",
    ];
    const hitCount = AI_CLICHES.filter(c => enLower.includes(c)).length;
    const clicheScore = Math.max(0, 15 - hitCount * 4);
    score += clicheScore;
    details.push(`AI套话${hitCount}处 +${clicheScore}`);
  }

  // --- 6. 标题长度 40-65 字符 (10分) ---
  if (data.titleEn) {
    const len = data.titleEn.length;
    if (len >= 40 && len <= 65) {
      score += 10;
      details.push(`标题${len}字符 +10`);
    } else if (len >= 30 && len <= 80) {
      score += 5;
      details.push(`标题${len}字符 +5`);
    } else {
      details.push(`标题${len}字符 +0`);
    }
  }

  // --- 7. 有无列表 <ul>/<ol> (10分) ---
  if (data.contentEn) {
    const hasList = /<[uo]l[\s>]/i.test(data.contentEn);
    if (hasList) {
      score += 10;
      details.push('有列表 +10');
    } else {
      details.push('无列表 +0');
    }
  }

  // --- 8. 多语言内容长度平衡度 (5分) ---
  const langs = ['contentEn', 'contentZh', 'contentJa', 'contentKo', 'contentEs'];
  const lengths = langs.map(l => (data[l] || '').replace(/<[^>]+>/g, '').length).filter(l => l > 0);
  if (lengths.length >= 3) {
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const maxDev = Math.max(...lengths.map(l => Math.abs(l - avg) / avg));
    if (maxDev <= 0.4) {
      score += 5;
      details.push('多语言均衡 +5');
    } else {
      details.push(`多语言偏差${(maxDev * 100).toFixed(0)}% +0`);
    }
  }

  // --- 评级 ---
  let grade;
  if (score >= 80) grade = 'A';
  else if (score >= 60) grade = 'B';
  else grade = 'C';

  const gradeEmoji = grade === 'A' ? '🏆' : grade === 'B' ? '👍' : '⚠️';
  console.log(`  ${gradeEmoji} 质量评分: ${score}/100 (${grade}级)`);
  details.forEach(d => console.log(`     - ${d}`));

  if (grade === 'C') {
    console.log('  ⚠️ C级文章：质量偏低，建议关注后续 SEO 表现');
  }

  return { score, grade, details };
}

// ============================================================
// HTML 净化 — 移除危险标签，保留安全标签
// ============================================================

function sanitizeHTML(html) {
  if (!html) return '';

  // 移除所有禁止的标签及其内容
  for (const tag of FORBIDDEN_TAGS) {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
    html = html.replace(regex, '');
    // 也移除自闭合形式
    const selfClose = new RegExp(`<${tag}[^>]*/?>`, 'gi');
    html = html.replace(selfClose, '');
  }

  // 移除 on* 事件属性（如 onclick, onerror 等）
  html = html.replace(/\s+on\w+\s*=\s*(['"])[^'"]*\1/gi, '');
  html = html.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');

  // 移除 javascript: 协议链接
  html = html.replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"');

  return html;
}

// ============================================================
// HTML 模板构建
// ============================================================

function buildHTML(data, queueItem, publishDate) {
  const slug = queueItem.slug;
  const tag = queueItem.tags[0] || 'guide';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(data.titleEn)} - Mzu favicondl</title>
    <meta name="description" content="${esc(data.descEn)}">
    <meta name="keywords" content="${esc(data.metaKeywords)}">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="https://favicondl.com/blog/${slug}.html">

    <link rel="icon" type="image/x-icon" href="/favicons/favicon.ico">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-touch-icon.png">
    <link rel="manifest" href="/favicons/site.webmanifest">
    <meta name="theme-color" content="#ffffff">

    <meta property="og:type" content="article">
    <meta property="og:url" content="https://favicondl.com/blog/${slug}.html">
    <meta property="og:title" content="${esc(data.titleEn)}">
    <meta property="og:description" content="${esc(data.descEn)}">
    <meta property="og:image" content="https://favicondl.com/favicons/android-chrome-512x512.png">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="${esc(data.titleEn)}">
    <meta name="twitter:description" content="${esc(data.descEn)}">
    <meta name="twitter:image" content="https://favicondl.com/favicons/android-chrome-512x512.png">

    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/blog/blog.css?v=20260211">

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-7QLC8QV609"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-7QLC8QV609');
    </script>

    <script type="application/ld+json">
    ${buildJsonLd(data.titleEn, data.descEn, publishDate, slug)}
    </script>
</head>
<body>
    <nav class="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50">
        <div class="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/index.html" class="flex items-center gap-2 font-semibold text-lg text-gray-900"><img src="/favicons/favicon-32x32.png" alt="Mzu favicondl logo" class="w-6 h-6">Mzu favicondl</a>
            <div class="flex items-center gap-8">
                <a href="/documentation.html" class="nav-link" data-en="Docs" data-zh="文档">Docs</a>
                <a href="/tools.html" class="nav-link" data-en="Tools" data-zh="工具">Tools</a>
                <a href="/blog/" class="nav-link" data-en="Blog" data-zh="博客">Blog</a>
                <div class="lang-dropdown"><button id="lang-toggle" class="lang-btn"><img class="lang-flag" src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg" alt="EN" style="width:20px;height:20px;"><svg class="w-3 h-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button><div id="lang-menu" class="lang-menu"><a href="/blog/${slug}.html" class="lang-option active" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg" alt="English" style="width:18px;height:18px;"><span>English</span></a><a href="/zh/blog/${slug}.html" class="lang-option" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e8-1f1f3.svg" alt="中文" style="width:18px;height:18px;"><span>中文</span></a><a href="/ja/blog/${slug}.html" class="lang-option" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1ef-1f1f5.svg" alt="日本語" style="width:18px;height:18px;"><span>日本語</span></a><a href="/ko/blog/${slug}.html" class="lang-option" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1f0-1f1f7.svg" alt="한국어" style="width:18px;height:18px;"><span>한국어</span></a><a href="/es/blog/${slug}.html" class="lang-option" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1ea-1f1f8.svg" alt="Español" style="width:18px;height:18px;"><span>Español</span></a></div></div>
            </div>
        </div>
    </nav>

    <article class="max-w-3xl mx-auto px-6 pt-12 pb-20">
        <nav class="text-sm text-gray-400 mb-8">
            <a href="/index.html" class="hover:text-gray-600">Home</a><span class="mx-2">/</span>
            <a href="/blog/" class="hover:text-gray-600">Blog</a><span class="mx-2">/</span>
            <span class="text-gray-600" data-en="${esc(data.breadcrumbEn)}" data-zh="${esc(data.breadcrumbZh)}">${esc(data.breadcrumbEn)}</span>
        </nav>

        <header class="mb-10">
            <div class="flex items-center gap-3 mb-4"><span class="tag">${esc(tag)}</span><time class="text-sm text-gray-400">${publishDate}</time></div>
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900 leading-tight" data-en="${esc(data.titleEn)}" data-zh="${esc(data.titleZh)}">${esc(data.titleEn)}</h1>
        </header>

        <div class="article-body" data-lang="en">
            ${data.contentEn}
        </div>

        <!-- 译文作为构建源保存在 template 中，不在英文页面渲染或参与可见正文。 -->
        <template data-article-lang="zh">${data.contentZh}</template>
        <template data-article-lang="ja">${data.contentJa}</template>
        <template data-article-lang="ko">${data.contentKo}</template>
        <template data-article-lang="es">${data.contentEs}</template>

        <div class="cta-box">
            <h3 data-en="${esc(data.ctaTitleEn)}" data-zh="${esc(data.ctaTitleZh)}" data-ja="${esc(data.ctaTitleJa)}" data-ko="${esc(data.ctaTitleKo)}" data-es="${esc(data.ctaTitleEs)}">${esc(data.ctaTitleEn)}</h3>
            <p data-en="${esc(data.ctaDescEn)}" data-zh="${esc(data.ctaDescZh)}" data-ja="${esc(data.ctaDescJa)}" data-ko="${esc(data.ctaDescKo)}" data-es="${esc(data.ctaDescEs)}">${esc(data.ctaDescEn)}</p>
            <a href="${data.ctaLink}" class="cta-btn" data-en="${esc(data.ctaBtnEn)}" data-zh="${esc(data.ctaBtnZh)}" data-ja="${esc(data.ctaBtnJa)}" data-ko="${esc(data.ctaBtnKo)}" data-es="${esc(data.ctaBtnEs)}">${esc(data.ctaBtnEn)}</a>
        </div>
    </article>

    <footer class="py-8 px-6 border-t border-gray-100">
        <div class="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <p class="text-gray-400 text-sm">&copy; ${new Date().getFullYear()} Mzu favicondl</p>
            <div class="flex gap-6">
                <a href="/index.html" class="text-gray-500 hover:text-gray-900 text-sm transition-colors" data-en="Home" data-zh="首页">Home</a>
                <a href="/blog/" class="text-gray-500 hover:text-gray-900 text-sm transition-colors" data-en="Blog" data-zh="博客">Blog</a>
                <a href="/privacy.html" class="text-gray-500 hover:text-gray-900 text-sm transition-colors" data-en="Privacy" data-zh="隐私政策">Privacy</a>
            </div>
        </div>
    </footer>
    <script src="/blog/blog.js?v=20260211"></script>
</body>
</html>
`;
}

// ============================================================
// Sitemap 更新
// ============================================================

function updateSitemap(slug, date) {
  let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf-8');

  // 检查是否已经存在此 URL（防止重复）
  if (sitemap.includes(`/blog/${slug}.html`)) {
    console.log(`  ⚠️ sitemap 中已存在 ${slug}.html，跳过`);
    return;
  }

  // 英文原版 + 4 种语言版本
  const langs = ['zh', 'ja', 'ko', 'es'];
  let newEntries = `  <url>
    <loc>https://favicondl.com/blog/${slug}.html</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>`;

  for (const lang of langs) {
    newEntries += `\n  <url>
    <loc>https://favicondl.com/${lang}/blog/${slug}.html</loc>
    <lastmod>${date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
  </url>`;
  }

  sitemap = sitemap.replace('</urlset>', newEntries + '\n</urlset>');
  fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf-8');
}

// ============================================================
// 工具函数
// ============================================================

/** HTML 属性值转义 */
function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 构建 Schema.org JSON-LD（使用 JSON.stringify 正确转义，不用 HTML 实体） */
function buildJsonLd(titleEn, descEn, publishDate, slug) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": titleEn,
    "description": descEn,
    "datePublished": publishDate,
    "dateModified": publishDate,
    "author": { "@type": "Organization", "name": "Mzu favicondl", "url": "https://favicondl.com" },
    "publisher": { "@type": "Organization", "name": "Mzu favicondl", "url": "https://favicondl.com" },
    "mainEntityOfPage": `https://favicondl.com/blog/${slug}.html`,
    "inLanguage": "en"
  }, null, 6);
}

// ============================================================
// 启动
// ============================================================

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error('❌ 未捕获错误:', err.message);
    process.exit(1);
  });
}

const BLOCK_STRUCTURE_TAGS = new Set([
  'p', 'h2', 'h3', 'pre', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote',
]);

function extractBlockStructure(html) {
  return [...String(html || '').matchAll(/<(\/?)([a-z0-9-]+)\b[^>]*>/gi)]
    .filter(match => BLOCK_STRUCTURE_TAGS.has(match[2].toLowerCase()))
    .map(match => `${match[1] ? '/' : ''}${match[2].toLowerCase()}`);
}

function extractHrefTargets(html) {
  return [...String(html || '').matchAll(/<a\b([^>]*)>/gi)]
    .map(match => match[1].match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2] || '');
}

function escapeUnexpectedHtmlTags(html) {
  return String(html || '').replace(/<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi, (fullTag, tagName) => {
    const tag = tagName.toLowerCase();
    if (ALLOWED_CONTENT_TAGS.has(tag) || FORBIDDEN_TAGS.includes(tag)) return fullTag;
    return fullTag
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  });
}

function validateTranslationContent(sourceHtml, translatedHtml, label = '翻译输出') {
  const errors = [];
  validateHtmlFragment(translatedHtml, label, errors);

  const sourceStructure = extractBlockStructure(sourceHtml);
  const translatedStructure = extractBlockStructure(translatedHtml);
  if (JSON.stringify(sourceStructure) !== JSON.stringify(translatedStructure)) {
    const mismatchAt = sourceStructure.findIndex((tag, index) => translatedStructure[index] !== tag);
    const position = mismatchAt === -1 ? Math.min(sourceStructure.length, translatedStructure.length) : mismatchAt;
    errors.push(`${label}改变了英文原文的段落/标题/列表/表格结构（第 ${position + 1} 个块级标签：原文 ${sourceStructure[position] || '结束'}，翻译 ${translatedStructure[position] || '结束'}）`);
  }

  const sourceHrefs = extractHrefTargets(sourceHtml);
  const translatedHrefs = extractHrefTargets(translatedHtml);
  if (JSON.stringify(sourceHrefs) !== JSON.stringify(translatedHrefs)) {
    errors.push(`${label}改变、遗漏或新增了英文原文链接`);
  }

  if (errors.length > 0) {
    const error = new Error(errors.join('；'));
    error.code = 'INVALID_MODEL_OUTPUT';
    throw error;
  }
  return translatedHtml;
}

export {
  ARTICLE_MODELS,
  TRANSLATION_MODELS,
  classifyModelError,
  escapeUnexpectedHtmlTags,
  ensureFirstPartyEvidence,
  normalizeDescription,
  parseModelList,
  requireStringFields,
  repairMissingMetadata,
  resolveOfficialSources,
  validateTranslationContent,
  validateKnownPlatformClaims,
  validateArticleData,
};

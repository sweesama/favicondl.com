/**
 * 自动博客文章生成脚本（v4 — 反 AI 八股文 + 全面 Bug 修复版）
 * 
 * v4 改进：
 * - 反 AI 八股文：Prompt 禁止 20+ 条常见 AI 套话，要求真实品牌案例和第一人称视角
 * - AI 套话检测：验证阶段自动扫描生成内容中的 AI 陈词滥调
 * - Schema.org Bug 修复：JSON-LD 改用 JSON.stringify（不再错误使用 HTML 实体）
 * - 温度 0.55：平衡准确性与可读性
 * - API 120s 超时：防止 Gemini 挂起导致脚本卡死
 * - 动态版权年份
 * 
 * v3 基础：
 * - 模型优先级：gemini-3-flash-preview → 2.5-flash → 2.5-pro
 * - 意图感知 / 自适应长度 / 语义去重 / 现代 SEO / responseMimeType: JSON
 * 
 * 使用方式：
 *   GEMINI_API_KEY=xxx node generate-article.js
 */

import { GoogleGenAI } from '@google/genai';
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

// API 配置
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ 错误：缺少 GEMINI_API_KEY 环境变量');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// 模型优先级列表（最新 → 备选 → 兜底）
const MODEL_LIST = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.1-flash-lite-preview'];
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 50000;

// 按 depth 字段对应的词数范围（英文词数）
const DEPTH_CONFIG = {
  brief: { minWords: 300, maxWords: 500, label: '简短' },
  standard: { minWords: 600, maxWords: 900, label: '标准' },
  deep: { minWords: 1000, maxWords: 1500, label: '深度' },
};

// 禁止出现的危险 HTML 标签 (移除了 link 和 meta，允许在代码示例中展示)
const FORBIDDEN_TAGS = ['script', 'iframe', 'object', 'embed', 'form', 'input', 'style', 'h1'];

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
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;

  console.log(`📝 关键词: "${nextItem.keyword}"`);
  console.log(`📄 输出: ${nextItem.slug}.html`);
  console.log(`🏷️  标签: [${nextItem.tags.join(', ')}]`);
  console.log(`🎯 意图: ${intent} | 深度: ${depthCfg.label}(${depthCfg.minWords}-${depthCfg.maxWords}词)\n`);

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
      articles, intent, depth, avoidOverlap
    );

    // --- 净化 HTML ---
    articleData.contentEn = sanitizeHTML(articleData.contentEn);
    articleData.contentZh = sanitizeHTML(articleData.contentZh);
    articleData.contentJa = sanitizeHTML(articleData.contentJa);
    articleData.contentKo = sanitizeHTML(articleData.contentKo);
    articleData.contentEs = sanitizeHTML(articleData.contentEs);

    // --- 质量评分 ---
    const { score: qualityScore, grade: qualityGrade } = scoreArticleQuality(articleData, nextItem.keyword, depth);

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

function buildPrompt(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap) {
  const depthCfg = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;

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

  return `You are a senior developer-blogger who writes like a real human — with opinions, humor, and hard-won experience. You write for Mzu favicondl (https://favicondl.com), a favicon download and conversion tool.

TARGET KEYWORD: "${keyword}"
SEARCH INTENT: ${intent}
TARGET LENGTH: ${depthCfg.minWords}-${depthCfg.maxWords} English words (strict)

=== WRITING STYLE ===
${writingStyle}

=== ⚠️ ANTI-AI RULES — READ THIS FIRST ===
Your writing MUST feel like a real developer sharing their experience on a personal blog.
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
- Include at least ONE real-world example using a well-known brand (GitHub, Google, Stripe, Apple, etc.) and describe what they actually do with their favicons.
- Have a clear OPINION. Don't just list options — recommend the best one and say why.
- Use SHORT paragraphs (2-3 sentences max). Long blocks of text are unreadable.
- Use occasional casual asides in parentheses (like this — they feel human).
- Every paragraph must teach something SPECIFIC the reader didn't know. No padding.

=== BRAND VOICE ===
- Like Apple docs meets a dev blog post. Clean, confident, opinionated.
- Audience: web developers and designers, all levels.
- NEVER use hype words ("amazing", "revolutionary", "game-changer", "unlock", "supercharge").
- NEVER mention competitors by name.
- Brand: always "Mzu favicondl" (lowercase "favicondl").
- Year: 2026 where relevant.

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
- Tables: <table><thead>...<tbody>...</table>.
- Internal links: relative paths (/blog/xxx.html). Link to 1-2 existing articles.
- FORBIDDEN: <script>, <style>, <iframe>, <form>, <input>, <h1>, <meta>, <img>.
- HTML only, no markdown.

=== 🏆 QUALITY SCORING CRITERIA (MANDATORY) ===
Your article will be graded automatically. To get an 'A' grade (100/100), you MUST include:
1. LONG FORM CONTENT: The English version MUST exceed the minimum word count specified above. Expand on examples, case studies, and common pitfalls to ensure depth.
2. CODE EXAMPLES: You MUST include at least one \`<pre><code>...</code></pre>\` block demonstrating a code snippet or configuration.
3. SUB-SECTIONS: You MUST break down your concepts using multiple \`<h3>\` headers. A high-scoring article has at least three \`<h3>\` sub-sections.
4. LISTS: You MUST include at least one bulleted list \`<ul>\` or numbered list \`<ol>\` to organize steps or features.
5. INTERNAL LINKS: You MUST include 1 or 2 internal links (e.g., \`<a href='/blog/example.html'>\`) using the existing articles provided above.

=== CHINESE CONTENT ===
- Full natural Chinese version — NOT literal translation.
- Adapt idioms and examples for Chinese readers. Keep technical terms in English.
- Apply the same anti-AI writing rules: no 套话 like "在当今数字化时代", "众所周知", "不言而喻". Write like a Chinese developer blogging, not a textbook.

=== MULTI-LANGUAGE (ja/ko/es) ===
CRITICAL SEO REQUIREMENT: DO NOT provide literal word-for-word translations. Google flags literal translations as "Duplicate without user-selected canonical". You MUST provide hyper-localized, culturally adapted content that feels like an independent article written by a native.
- Re-write the intro and examples to fit local context (e.g., use regional brand examples instead of US-only).
- Structure can vary slightly if it makes more sense in the target language.
- titleJa/Ko/Es: Highly optimized, native-sounding titles. Use local search habits.
- descJa/Ko/Es: Compelling meta descriptions adapted for each language.
- contentJa/Ko/Es: Full HTML article body. KEEP HTML STRUCTURE IN TACT but completely rewrite the narrative so it isn't an exact replica of the English version.
- ctaTitleJa/Ko/Es, ctaDescJa/Ko/Es, ctaBtnJa/Ko/Es: Native, persuasive CTA copy.
- Keep technical terms (favicon, ICO, PNG, SVG) in English.
- Japanese: use です/ます style, active tech blogger tone. Korean: use 합니다 style. Spanish: use "tú" form, casual tech instructor tone.

=== OUTPUT FORMAT ===
Return ONLY valid JSON.
CRITICAL: Do NOT use literal newlines inside string values. Export strings as single continuous lines and use \\n for line breaks. Do NOT leave unescaped double quotes inside strings.

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
  "contentZh": "<p>中文文章正文...</p>",
  "contentJa": "<p>日本語の記事本文...</p>",
  "contentKo": "<p>한국어 기사 본문...</p>",
  "contentEs": "<p>Cuerpo del artículo en español...</p>",
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
// AI 调用 — 带重试和多模型降级
// ============================================================

async function generateArticleContent(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap) {
  const prompt = buildPrompt(keyword, slug, tags, existingArticles, intent, depth, avoidOverlap);

  console.log('🤖 正在调用 Gemini API 生成文章...');

  let usedModel = '';

  for (const modelName of MODEL_LIST) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`  → 模型 ${modelName} (第 ${attempt}/${MAX_RETRIES} 次)...`);
        // 240 秒超时，防止 API 挂起
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('API 调用超时(240s)')), 240000)
        );
        const result = await Promise.race([
          ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              temperature: 0.55,       // 平衡准确性与可读性（0.4太死板，0.7太散）
              topP: 0.88,
              maxOutputTokens: 65536,
              responseMimeType: 'application/json',
            }
          }),
          timeoutPromise
        ]);

        const responseText = result.text;
        usedModel = modelName;
        console.log(`  ✅ ${modelName} 响应成功 (${responseText.length} 字符)`);

        // --- 解析 JSON ---
        const data = parseAIResponse(responseText);
        
        // --- 验证文章数据 ---
        validateArticleData(data, keyword, depth);

        console.log(`✅ AI 生成完成 [${usedModel}]: "${data.titleEn}"`);
        return data;

      } catch (err) {
        const isRateLimit = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED');
        const isJsonError = err.message?.includes('JSON');
        const isValidationError = err.message?.includes('质量检查失败');
        
        let errSummary = err.message?.substring(0, 100);
        if (isRateLimit) errSummary = '配额限制';
        else if (isJsonError) errSummary = '返回了无效的 JSON';
        else if (isValidationError) errSummary = err.message.split('\n')[0];

        console.log(`  ⚠️ ${modelName} 失败: ${errSummary}`);

        if ((isRateLimit || isJsonError || isValidationError) && attempt < MAX_RETRIES) {
          const delay = isRateLimit ? RETRY_DELAY_MS : 3000;
          console.log(`  ⏳ 等待 ${delay / 1000} 秒后重试...`);
          await new Promise(r => setTimeout(r, delay));
        } else if ((isJsonError || isValidationError) && attempt === MAX_RETRIES) {
          console.log(`  ⏭️ ${modelName} 已达最大重试次数，切换下一个模型...`);
          break; // 当前模型已用完机会，换下一个模型
        } else if (!isRateLimit && !isJsonError && !isValidationError) {
          break; // 非限流、非JSON、非验证错误 → 直接换下一个模型
        } else if (isRateLimit && attempt === MAX_RETRIES) {
          console.log(`  ⏭️ ${modelName} 限流重试已达上限，尝试下一个模型...`);
          break;
        }
      }
    }
  }

  throw new Error('所有模型均调用失败，请检查 API Key 和配额');
}

// ============================================================
// AI 响应解析 — 健壮的 JSON 提取
// ============================================================

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

function validateArticleData(data, keyword, depth) {
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

  // --- 9. HTML 基本结构 ---
  if (data.contentEn) {
    if (!/<h2[\s>]/i.test(data.contentEn)) warnings.push('英文内容缺少 <h2>');
    if (!/<p[\s>]/i.test(data.contentEn)) errors.push('英文内容缺少 <p>');
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

function scoreArticleQuality(data, keyword, depth) {
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

  // --- 2. 有无代码示例 <code> 或 <pre> (15分) ---
  if (data.contentEn) {
    const hasPre = /<pre[\s>]/i.test(data.contentEn);
    const hasCode = /<code[\s>]/i.test(data.contentEn);
    if (hasPre) {
      score += 15;
      details.push('有代码块 +15');
    } else if (hasCode) {
      score += 8;
      details.push('有行内代码 +8');
    } else {
      details.push('无代码示例 +0');
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
    const internalLinks = (data.contentEn.match(/<a\s+href="\/blog\//gi) || []).length;
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

        <div class="article-body" data-lang="zh" style="display:none">
            ${data.contentZh}
        </div>

        <div class="article-body" data-lang="ja" style="display:none">
            ${data.contentJa}
        </div>

        <div class="article-body" data-lang="ko" style="display:none">
            ${data.contentKo}
        </div>

        <div class="article-body" data-lang="es" style="display:none">
            ${data.contentEs}
        </div>

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

main().catch(err => {
  console.error('❌ 未捕获错误:', err.message);
  process.exit(1);
});

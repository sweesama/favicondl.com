// ============================================================
// 一次性脚本：为旧博客文章补充 ja/ko/es 正文翻译
// 使用 Gemini API，每篇文章 1 次 API 调用（翻译 en → ja+ko+es）
// 
// 用法：
//   GEMINI_API_KEY=xxx node translate-old-articles.js
//   GEMINI_API_KEY=xxx node translate-old-articles.js --limit 5
//
// Gemini 免费额度：20 RPD，所以 23 篇文章需要分 2 天跑
// 脚本会自动跳过已有 ja/ko/es 正文的文章
// ============================================================

import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

const BLOG_DIR = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), '..');
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.error('❌ 缺少 GEMINI_API_KEY 环境变量');
  console.error('   用法: GEMINI_API_KEY=xxx node translate-old-articles.js');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
const MODEL_LIST = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
const RETRY_DELAY_MS = 10000;

// 从命令行参数获取限制数（付费层 10K RPD，可一次跑完所有文章）
const limitArg = process.argv.find(a => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(process.argv[process.argv.indexOf(limitArg) + 1]) || 50 : 50;

// ============================================================
// 主函数
// ============================================================

async function main() {
  console.log('🌐 旧文章翻译脚本 — 补充 ja/ko/es 正文');
  console.log(`   限制: ${LIMIT} 篇/次\n`);

  // 找出所有需要翻译的文章
  const htmlFiles = fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .sort();

  const needTranslation = [];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(BLOG_DIR, file), 'utf-8');
    // 检查是否已有 ja 正文块
    if (content.includes('data-lang="ja"')) {
      continue; // 已翻译，跳过
    }
    // 检查是否有英文正文块
    if (!content.includes('data-lang="en"')) {
      console.log(`  ⚠️ ${file} 没有英文正文块，跳过`);
      continue;
    }
    needTranslation.push(file);
  }

  console.log(`   总计 ${htmlFiles.length} 篇文章`);
  console.log(`   需要翻译: ${needTranslation.length} 篇`);
  console.log(`   本次处理: ${Math.min(needTranslation.length, LIMIT)} 篇\n`);

  if (needTranslation.length === 0) {
    console.log('🎉 所有文章已翻译完毕！');
    return;
  }

  const toProcess = needTranslation.slice(0, LIMIT);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const file = toProcess[i];
    console.log(`\n[${ i + 1}/${toProcess.length}] 翻译 ${file} ...`);

    try {
      await translateArticle(file);
      successCount++;
      console.log(`  ✅ ${file} 翻译完成`);

      // API 限流：每次调用后等 3 秒
      if (i < toProcess.length - 1) {
        await sleep(3000);
      }
    } catch (err) {
      failCount++;
      console.error(`  ❌ ${file} 翻译失败: ${err.message}`);
    }
  }

  const remaining = needTranslation.length - successCount;
  console.log('\n' + '='.repeat(50));
  console.log(`🏁 翻译完成！成功: ${successCount} | 失败: ${failCount} | 剩余: ${remaining}`);
  if (remaining > 0) {
    console.log(`   请明天再运行一次以处理剩余 ${remaining} 篇文章`);
  }
  console.log('='.repeat(50));
}

// ============================================================
// 翻译单篇文章
// ============================================================

async function translateArticle(filename) {
  const filePath = path.join(BLOG_DIR, filename);
  let html = fs.readFileSync(filePath, 'utf-8');

  // 提取英文正文
  const enMatch = html.match(/<div class="article-body" data-lang="en">([\s\S]*?)<\/div>\s*(?=<!--|\s*<div)/);
  if (!enMatch) {
    throw new Error('无法提取英文正文');
  }
  const enContent = enMatch[1].trim();

  // 调用 Gemini API 翻译
  const translations = await callGeminiTranslate(enContent, filename);

  // 找到 cta-box 的位置，在其前面插入 ja/ko/es 块
  const ctaIndex = html.indexOf('<div class="cta-box">');
  if (ctaIndex === -1) {
    throw new Error('无法找到 cta-box 元素');
  }

  const beforeInsert = html.slice(0, ctaIndex);
  const afterInsert = html.slice(ctaIndex);

  const newBlocks = `

        <div class="article-body" data-lang="ja" style="display:none">
            ${translations.ja}
        </div>

        <div class="article-body" data-lang="ko" style="display:none">
            ${translations.ko}
        </div>

        <div class="article-body" data-lang="es" style="display:none">
            ${translations.es}
        </div>
`;

  html = beforeInsert + newBlocks + afterInsert;
  fs.writeFileSync(filePath, html, 'utf-8');
}

// ============================================================
// Gemini API 调用 — 带重试和多模型降级
// ============================================================

async function callGeminiTranslate(enContent, filename) {
  const prompt = buildTranslatePrompt(enContent, filename);

  for (const model of MODEL_LIST) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`  🤖 尝试 ${model} (第 ${attempt} 次)...`);

        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            temperature: 0.3,
            maxOutputTokens: 65536,
            responseMimeType: 'application/json',
          },
        });

        const text = response.text.trim();
        const json = JSON.parse(text);

        // 验证
        if (!json.contentJa || !json.contentKo || !json.contentEs) {
          throw new Error('返回 JSON 缺少必要字段');
        }
        if (json.contentJa.length < 100 || json.contentKo.length < 100 || json.contentEs.length < 100) {
          throw new Error('翻译内容过短');
        }

        return { ja: json.contentJa, ko: json.contentKo, es: json.contentEs };

      } catch (err) {
        console.log(`    ⚠️ ${model} 失败: ${err.message}`);
        if (attempt < 2) {
          console.log(`    ⏳ 等待 ${RETRY_DELAY_MS / 1000}s 后重试...`);
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
  }

  throw new Error('所有模型均失败');
}

// ============================================================
// 翻译提示词
// ============================================================

function buildTranslatePrompt(enContent, filename) {
  return `You are a professional web content translator. Translate the following English blog article HTML into three languages: Japanese, Korean, and Spanish.

=== RULES ===
- Output ONLY valid JSON with three keys: "contentJa", "contentKo", "contentEs"
- Each value is the full translated HTML article body
- Preserve ALL HTML tags and structure exactly (h2, h3, p, ul, li, table, pre, code, a, strong, em, etc.)
- Preserve all href links unchanged
- Keep technical terms in English: favicon, ICO, PNG, SVG, CSS, HTML, JavaScript, PWA, CDN, CORS, API, etc.
- Do NOT add any new tags or remove existing ones
- Do NOT translate code snippets inside <pre><code> blocks
- Japanese: use です/ます style, natural developer blog tone
- Korean: use 합니다 style, natural developer blog tone
- Spanish: use "tú" form, natural developer blog tone
- Adapt naturally for each language's readers — NOT literal word-by-word translation
- No AI clichés or filler phrases

=== ARTICLE TO TRANSLATE (from ${filename}) ===
${enContent}

=== OUTPUT FORMAT ===
{
  "contentJa": "<p>translated Japanese HTML...</p>",
  "contentKo": "<p>translated Korean HTML...</p>",
  "contentEs": "<p>translated Spanish HTML...</p>"
}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('💥 脚本异常:', err);
  process.exit(1);
});

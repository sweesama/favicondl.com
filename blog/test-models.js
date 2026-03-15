import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const API_KEY = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey: API_KEY });

const MOCK_PROMPT = `You are a senior developer-blogger who writes like a real human — with opinions, humor, and hard-won experience. You write for Mzu favicondl (https://favicondl.com), a favicon download and conversion tool.

TARGET KEYWORD: "favicon best practices"
SEARCH INTENT: informational
TARGET LENGTH: 1000-1500 English words (strict)

=== WRITING STYLE ===
Write an educational article that explains the concept clearly.
Structure: Definition → Why it matters → How it works → Best practices → Conclusion.
Tone: Teacher explaining to a student. Include clear examples.

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

=== HTML RULES ===
- 🛠️ CRITICAL: You MUST use single quotes for all HTML attributes (e.g., <a href='/link' class='btn'>). Do NOT use double quotes. This is mandatory to prevent breaking the JSON string escaping.
- <h2> for sections, <h3> for sub-sections. NEVER <h1>.
- <p> for paragraphs. <strong> for key terms. <code> for inline code.
- Code blocks: <pre><code>...</code></pre>.
- Tables: <table><thead>...<tbody>...</table>.
- Internal links: relative paths (/blog/xxx.html). Link to 1-2 existing articles.
- FORBIDDEN: <script>, <style>, <iframe>, <form>, <input>, <h1>, <meta>, <img>.
- HTML only, no markdown.

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
  "contentEs": "<p>Cuerpo del artículo en español...</p>"
}`;

async function testModel(modelName) {
    console.log(`\n============================`);
    console.log(`Testing model: ${modelName}`);
    console.log(`============================`);
    
    try {
        const result = await ai.models.generateContent({
            model: modelName,
            contents: MOCK_PROMPT,
            config: {
                temperature: 0.55,
                topP: 0.88,
                maxOutputTokens: 65536,
                responseMimeType: 'application/json',
            }
        });

        const data = JSON.parse(result.text);
        
        // Analyze contentEn
        const contentEn = data.contentEn || '';
        const plainText = contentEn.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const wordCount = plainText.split(' ').filter(w => w.length > 0).length;
        
        const hasPre = /<pre[\s>]/i.test(contentEn);
        const hasCode = /<code[\s>]/i.test(contentEn);
        const h3Count = (contentEn.match(/<h3[\s>]/gi) || []).length;
        const h2Count = (contentEn.match(/<h2[\s>]/gi) || []).length;
        const internalLinks = (contentEn.match(/<a\s+href='\/blog\//gi) || []).length;
        const hasList = /<[uo]l[\s>]/i.test(contentEn);
        
        console.log(`✅ Success for ${modelName}`);
        console.log(`- Word Count: ${wordCount} (Target: 1000-1500)`);
        console.log(`- H2 Count: ${h2Count}`);
        console.log(`- H3 Count: ${h3Count}`);
        console.log(`- Has <pre>: ${hasPre}`);
        console.log(`- Has <code>: ${hasCode}`);
        console.log(`- Has Lists (ul/ol): ${hasList}`);
        console.log(`- Internal Links: ${internalLinks}`);
        
    } catch (e) {
        console.error(`❌ Failed for ${modelName}:`, e.message);
    }
}

async function run() {
    await testModel('gemini-3.1-flash-lite-preview');
    await testModel('gemini-2.5-flash');
}

run();

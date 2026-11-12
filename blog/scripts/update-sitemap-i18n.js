// 一次性脚本：为 sitemap.xml 补充多语言 URL（zh/ja/ko/es）
// 用法: node update-sitemap-i18n.js

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1'), '../..');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');
const LANGS = ['zh', 'ja', 'ko', 'es'];

// Same consolidation as generate-article.js localizedSitemapUrl(): the es blog
// files 301 to the Spanish size page, so this script must not recreate them.
const SPANISH_SIZE_FILES = new Set([
  'favicon-sizes-guide.html',
  'favicon-best-size-2026.html',
]);
const SPANISH_SIZE_URL = 'https://favicondl.com/es/tamanos-de-favicon.html';

function localizedBlogUrl(file, lang) {
  if (lang === 'es' && SPANISH_SIZE_FILES.has(file)) return SPANISH_SIZE_URL;
  return `https://favicondl.com/${lang}/blog/${file}`;
}

function stripSitemapUrl(xml, loc) {
  const escaped = loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(new RegExp(`\\n  <url>\\s*<loc>${escaped}</loc>[\\s\\S]*?</url>`, 'g'), '');
}

let sitemap = fs.readFileSync(SITEMAP_PATH, 'utf-8');
const today = new Date().toISOString().split('T')[0];

// 匹配所有现有的 <loc> URL
const locRegex = /<loc>(https:\/\/favicondl\.com\/[^<]*)<\/loc>/g;
const existingUrls = new Set();
let match;
while ((match = locRegex.exec(sitemap)) !== null) {
  existingUrls.add(match[1]);
}

// 收集需要添加的多语言 URL
const newEntries = [];

// 主页面的多语言版本
const mainPages = [
  { path: '/', priority: '0.9', freq: 'monthly' },
  { path: '/tools.html', priority: '0.7', freq: 'monthly' },
  { path: '/documentation.html', priority: '0.5', freq: 'monthly' },
  { path: '/privacy.html', priority: '0.2', freq: 'yearly' },
  { path: '/blog/', priority: '0.6', freq: 'daily' },
];

for (const page of mainPages) {
  for (const lang of LANGS) {
    const url = `https://favicondl.com/${lang}${page.path}`;
    if (!existingUrls.has(url)) {
      newEntries.push({ url, priority: page.priority, freq: page.freq, date: today });
    }
  }
}

// 博客文章的多语言版本
const blogDir = path.join(ROOT, 'blog');
const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');

let rewroteSpanishSizeUrls = false;
for (const file of SPANISH_SIZE_FILES) {
  const obsolete = `https://favicondl.com/es/blog/${file}`;
  if (!sitemap.includes(obsolete)) continue;
  sitemap = stripSitemapUrl(sitemap, obsolete);
  existingUrls.delete(obsolete);
  rewroteSpanishSizeUrls = true;
}
if (!existingUrls.has(SPANISH_SIZE_URL) && !sitemap.includes(SPANISH_SIZE_URL)) {
  newEntries.push({ url: SPANISH_SIZE_URL, priority: '0.8', freq: 'monthly', date: today });
  existingUrls.add(SPANISH_SIZE_URL);
}

for (const file of blogFiles) {
  for (const lang of LANGS) {
    const url = localizedBlogUrl(file, lang);
    if (!existingUrls.has(url)) {
      // 尝试从现有 sitemap 获取日期
      const enUrl = `https://favicondl.com/blog/${file}`;
      const dateMatch = sitemap.match(new RegExp(`<loc>${enUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>([^<]+)</lastmod>`));
      const date = dateMatch ? dateMatch[1] : today;
      newEntries.push({ url, priority: '0.4', freq: 'monthly', date });
      existingUrls.add(url);
    }
  }
}

if (newEntries.length === 0 && !rewroteSpanishSizeUrls) {
  console.log('✅ sitemap.xml 已包含所有多语言 URL，无需更新');
  process.exit(0);
}

// 生成新条目
let entriesXml = '';
for (const entry of newEntries) {
  entriesXml += `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${entry.date}</lastmod>
    <changefreq>${entry.freq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>\n`;
}

sitemap = sitemap.replace('</urlset>', entriesXml + '</urlset>');
fs.writeFileSync(SITEMAP_PATH, sitemap, 'utf-8');

console.log(`✅ 已添加 ${newEntries.length} 个多语言 URL 到 sitemap.xml`);
console.log(`   总 URL 数: ${existingUrls.size + newEntries.length}`);

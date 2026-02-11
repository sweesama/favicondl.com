#!/usr/bin/env node
/**
 * i18n Build Script — 从英文源页面生成多语言版本
 * 用法: cd i18n && npm install && npm run build
 *
 * 输出: /{lang}/index.html, /{lang}/tools.html 等
 * 同时给英文根页面注入 hreflang 标签和多语言切换器
 */

import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 配置 ───────────────────────────────────────────────
const DOMAIN = 'https://favicondl.com';
const LANGUAGES = ['zh', 'ja', 'ko', 'es'];
const ALL_LANGS = ['en', ...LANGUAGES];
const PAGES = [
  'index.html',
  'tools.html',
  'documentation.html',
  'privacy.html',
  '404.html',
];

const FLAGS = {
  en: { svg: '1f1fa-1f1f8', name: 'English' },
  zh: { svg: '1f1e8-1f1f3', name: '中文' },
  ja: { svg: '1f1ef-1f1f5', name: '日本語' },
  ko: { svg: '1f1f0-1f1f7', name: '한국어' },
  es: { svg: '1f1ea-1f1f8', name: 'Español' },
};

const flagUrl = (code) =>
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${FLAGS[code].svg}.svg`;

// ─── 翻译加载 ───────────────────────────────────────────
function loadTranslations() {
  const t = {};
  for (const lang of LANGUAGES) {
    t[lang] = JSON.parse(
      fs.readFileSync(path.join(__dirname, `${lang}.json`), 'utf-8')
    );
  }
  return t;
}

// ─── hreflang 标签生成 ──────────────────────────────
// page 可以是 'index.html' 或 'blog/index.html' 等子目录路径
function hreflangTags(page) {
  // 将 page 转换为 URL 路径：'index.html' -> '/', 'blog/index.html' -> '/blog/', 'tools.html' -> '/tools.html'
  let pagePath;
  if (page.endsWith('/index.html')) {
    pagePath = '/' + page.replace('/index.html', '/'); // 'blog/index.html' -> '/blog/'
  } else if (page === 'index.html') {
    pagePath = '/';
  } else {
    pagePath = '/' + page;
  }
  const tags = [];
  tags.push(`<link rel="alternate" hreflang="en" href="${DOMAIN}${pagePath}">`);
  tags.push(`<link rel="alternate" hreflang="x-default" href="${DOMAIN}${pagePath}">`);
  for (const lang of LANGUAGES) {
    tags.push(
      `<link rel="alternate" hreflang="${lang}" href="${DOMAIN}/${lang}${pagePath}">`
    );
  }
  return '\n    ' + tags.join('\n    ');
}

// ─── 语言切换器 HTML ──────────────────────────────
function pageToPath(page) {
  if (page.endsWith('/index.html')) return '/' + page.replace('/index.html', '/');
  if (page === 'index.html') return '/';
  return '/' + page;
}

function switcherDropdown(currentLang, page) {
  const pagePath = pageToPath(page);
  const options = ALL_LANGS.map((lang) => {
    const href = lang === 'en' ? pagePath : `/${lang}${pagePath}`;
    const active = lang === currentLang ? ' active' : '';
    return `<a href="${href}" class="lang-option${active}" style="text-decoration:none;"><img src="${flagUrl(lang)}" alt="${FLAGS[lang].name}" style="width:18px;height:18px;"><span>${FLAGS[lang].name}</span></a>`;
  }).join('\n                        ');

  return `<div class="lang-dropdown">
                    <button id="lang-toggle" class="lang-btn">
                        <img class="lang-flag" src="${flagUrl(currentLang)}" alt="${FLAGS[currentLang].name}" style="width:20px;height:20px;">
                        <svg class="w-3 h-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <div id="lang-menu" class="lang-menu">
                        ${options}
                    </div>
                </div>`;
}

// ─── 移动端语言切换器 ─────────────────────────────
function switcherMobile(currentLang, page) {
  const pagePath = pageToPath(page);
  return ALL_LANGS.map((lang) => {
    const href = lang === 'en' ? pagePath : `/${lang}${pagePath}`;
    const active = lang === currentLang ? ' active' : '';
    return `<a href="${href}" class="lang-mobile-btn${active}" style="text-decoration:none;"><img src="${flagUrl(lang)}" alt="${FLAGS[lang].name}" style="width:18px;height:18px;"><span>${FLAGS[lang].name}</span></a>`;
  }).join('\n                    ');
}

// ─── JS/CSS 相对路径改为绝对路径 ───────────────────────
function absolutifyScripts($) {
  $('script[src]').each(function () {
    const src = $(this).attr('src');
    if (!src) return;
    // 跳过已经是绝对路径或外部 CDN
    if (src.startsWith('/') || src.startsWith('http')) return;
    // 相对路径改为绝对路径（如 main.js?v=xxx → /main.js?v=xxx）
    $(this).attr('src', '/' + src);
  });
  $('link[rel="stylesheet"][href]').each(function () {
    const href = $(this).attr('href');
    if (!href) return;
    if (href.startsWith('/') || href.startsWith('http')) return;
    $(this).attr('href', '/' + href);
  });
}

// ─── 内部链接前缀 ──────────────────────────────────────
function prefixLinks($, lang) {
  $('a[href]').each(function () {
    const href = $(this).attr('href');
    if (!href) return;
    // 跳过外部链接、锚点、javascript、mailto
    if (/^(https?:|mailto:|javascript:|#)/i.test(href)) return;
    // 对 .html 链接和目录链接加语言前缀
    if (href.endsWith('.html') || href === '/' || href.endsWith('/')) {
      const prefix = href.startsWith('/') ? `/${lang}` : `/${lang}/`;
      $(this).attr('href', prefix + href);
    }
  });
}

// ─── 替换文本内容 ───────────────────────────────────────
function translateContent($, lang, strings) {
  $('[data-en]').each(function () {
    const enText = $(this).attr('data-en');
    let translated;

    if (lang === 'zh') {
      // 中文直接取 data-zh 属性（已经手写在 HTML 里）
      translated = $(this).attr('data-zh');
    } else {
      translated = strings[enText];
    }

    if (translated && $(this).children().length === 0) {
      $(this).text(translated);
    }
  });
}

// ─── 替换 meta 标签 ────────────────────────────────────
function translateMeta($, lang, pageMeta, page) {
  // lang 属性
  $('html').attr('lang', lang);

  // title
  if (pageMeta?.title) $('title').text(pageMeta.title);

  // meta description
  if (pageMeta?.description)
    $('meta[name="description"]').attr('content', pageMeta.description);

  // OG
  if (pageMeta?.ogTitle) {
    $('meta[property="og:title"]').attr('content', pageMeta.ogTitle);
    $('meta[name="twitter:title"]').attr('content', pageMeta.ogTitle);
  }
  if (pageMeta?.ogDescription) {
    $('meta[property="og:description"]').attr('content', pageMeta.ogDescription);
    $('meta[name="twitter:description"]').attr('content', pageMeta.ogDescription);
  }

  // Canonical + OG URL
  const pagePath = page === 'index.html' ? '/' : `/${page}`;
  $('link[rel="canonical"]').attr('href', `${DOMAIN}/${lang}${pagePath}`);
  $('meta[property="og:url"]').attr('content', `${DOMAIN}/${lang}${pagePath}`);
}

// ─── 替换语言切换器 ────────────────────────────────────
function replaceSwitcher($, lang, page) {
  // 桌面端：替换 .lang-dropdown
  const desktopDropdown = $('.lang-dropdown').first();
  if (desktopDropdown.length) {
    desktopDropdown.replaceWith(switcherDropdown(lang, page));
  }

  // 移动端：替换 .lang-mobile-group
  const mobileGroup = $('.lang-mobile-group');
  if (mobileGroup.length) {
    mobileGroup.html(switcherMobile(lang, page));
  }
}

// ─── 构建单个语言页面 ──────────────────────────────────
function buildPage(html, lang, page, translations) {
  const $ = load(html, { decodeEntities: false });
  const t = translations[lang];
  const pageName = page.replace('.html', '');

  // 1. Meta 标签
  translateMeta($, lang, t._pages?.[pageName], page);

  // 2. 文本内容替换
  translateContent($, lang, t._strings || {});

  // 3. hreflang（先移除已有的，保证幂等）
  $('link[rel="alternate"][hreflang]').remove();
  $('link[rel="canonical"]').after(hreflangTags(page));

  // 4. JS/CSS 相对路径改绝对路径
  absolutifyScripts($);

  // 5. 内部链接加前缀（必须在替换切换器之前执行）
  prefixLinks($, lang);

  // 6. 语言切换器（在 prefixLinks 之后，避免切换器链接被二次加前缀）
  replaceSwitcher($, lang, page);

  // 输出（支持子目录如 blog/index.html）
  const outFile = path.join(ROOT, lang, page);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, $.html(), 'utf-8');
}

// ─── 给英文根页面注入 hreflang + 多语言切换器 ─────────
function patchEnglishPage(html, page) {
  const $ = load(html, { decodeEntities: false });

  // 如果已经有 hreflang，先移除（幂等）
  $('link[rel="alternate"][hreflang]').remove();

  // 注入 hreflang
  $('link[rel="canonical"]').after(hreflangTags(page));

  // 替换语言切换器
  replaceSwitcher($, 'en', page);

  return $.html();
}

// ─── 复制静态资源软链接 ────────────────────────────────
function ensureSharedAssets(lang) {
  // 各语言目录需要能访问到 /favicons/、/blog/ 等资源
  // 因为 Vercel 是静态服务，语言目录下的页面用的是绝对路径 /favicons/...
  // 所以不需要复制资源，绝对路径直接指向根目录
}

// ─── 清理语言目录中的过期 JS 文件 ─────────────────────────
function cleanOldJsFiles(lang) {
  const jsFiles = ['main.js', 'tools.js'];
  const outDir = path.join(ROOT, lang);
  for (const file of jsFiles) {
    const dest = path.join(outDir, file);
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }
}

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  console.log('🌐 i18n Build — 开始生成多语言页面\n');
  console.log(`   语言: ${ALL_LANGS.join(', ')}`);
  console.log(`   页面: ${PAGES.join(', ')}\n`);

  const translations = loadTranslations();
  let totalPages = 0;

  for (const page of PAGES) {
    const srcPath = path.join(ROOT, page);
    if (!fs.existsSync(srcPath)) {
      console.log(`⚠️  跳过 ${page}（文件不存在）`);
      continue;
    }
    const html = fs.readFileSync(srcPath, 'utf-8');

    // 为每种目标语言生成页面
    for (const lang of LANGUAGES) {
      buildPage(html, lang, page, translations);
      totalPages++;
    }

    // 更新英文根页面（注入 hreflang + 多语言切换器）
    const patchedEnglish = patchEnglishPage(html, page);
    fs.writeFileSync(srcPath, patchedEnglish, 'utf-8');

    console.log(`✅ ${page} → en(patched), ${LANGUAGES.join(', ')}`);
  }

  // 清理旧的 JS 重定向文件（不再需要）
  for (const lang of LANGUAGES) {
    ensureSharedAssets(lang);
    cleanOldJsFiles(lang);
  }

  // ─── 博客页面 ────────────────────────────────
  const blogDir = path.join(ROOT, 'blog');
  if (fs.existsSync(blogDir)) {
    const blogFiles = fs.readdirSync(blogDir)
      .filter(f => f.endsWith('.html'));
    console.log(`\n   博客页面: ${blogFiles.join(', ')}\n`);

    for (const file of blogFiles) {
      const blogPage = `blog/${file}`;  // 如 'blog/index.html'
      const srcPath = path.join(ROOT, blogPage);
      const html = fs.readFileSync(srcPath, 'utf-8');

      for (const lang of LANGUAGES) {
        buildPage(html, lang, blogPage, translations);
        totalPages++;
      }

      // 给英文博客页注入 hreflang + 切换器
      const patchedBlog = patchEnglishPage(html, blogPage);
      fs.writeFileSync(srcPath, patchedBlog, 'utf-8');

      console.log(`✅ ${blogPage} → en(patched), ${LANGUAGES.join(', ')}`);
    }
  }

  console.log(`\n🎉 完成！共生成 ${totalPages} 个多语言页面`);
  console.log('   目录:', LANGUAGES.map((l) => `/${l}/`).join(', '));
}

main().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});

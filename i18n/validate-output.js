#!/usr/bin/env node

import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOMAIN = 'https://favicondl.com';
const LANGUAGES = ['en', 'zh', 'ja', 'ko', 'es'];
const SUFFIX = { en: 'En', zh: 'Zh', ja: 'Ja', ko: 'Ko', es: 'Es' };
const SCHEMA_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja', ko: 'ko', es: 'es' };
const NOINDEX_SLUGS = new Set();
const ENCODED_STRUCTURE = /&lt;\/?(?:p|h2|h3|ul|ol|li|pre|code|a|table|thead|tbody|tr|th|td|blockquote)\b/i;
const PAGE_LEVEL_TAGS = 'script, style, iframe, object, embed, form, input, meta, link, h1';

const articles = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'blog', 'articles.json'), 'utf-8')
);
const errors = [];
const titles = new Map();
const descriptions = new Map();
const CORE_PAGES = ['index.html', 'tools.html', 'documentation.html', 'privacy.html', 'blog/index.html'];

function fail(message) {
  errors.push(message);
}

function addUnique(map, value, label, file) {
  if (!value) return fail(`${file}: missing ${label}`);
  if (map.has(value)) fail(`${file}: duplicate ${label} also used by ${map.get(value)}`);
  else map.set(value, file);
}

function expectedPath(slug, lang) {
  return lang === 'en'
    ? path.join(ROOT, 'blog', `${slug}.html`)
    : path.join(ROOT, lang, 'blog', `${slug}.html`);
}

function expectedUrl(slug, lang) {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  return `${DOMAIN}${prefix}/blog/${slug}.html`;
}

for (const article of articles) {
  const sourceFile = path.join(ROOT, 'blog', `${article.slug}.html`);
  const sourceRelative = path.relative(ROOT, sourceFile).replaceAll('\\', '/');
  if (!fs.existsSync(sourceFile)) {
    fail(`${sourceRelative}: source article missing`);
    continue;
  }
  const sourceHtml = fs.readFileSync(sourceFile, 'utf-8');
  if (ENCODED_STRUCTURE.test(sourceHtml)) {
    fail(`${sourceRelative}: encoded structural HTML found outside a code example`);
  }
  if (/```/.test(sourceHtml)) {
    fail(`${sourceRelative}: Markdown code fence found in HTML output`);
  }

  for (const lang of LANGUAGES) {
    const file = expectedPath(article.slug, lang);
    const relativeFile = path.relative(ROOT, file).replaceAll('\\', '/');
    if (!fs.existsSync(file)) {
      fail(`${relativeFile}: file missing`);
      continue;
    }

    const rawHtml = fs.readFileSync(file, 'utf-8');
    const $ = load(rawHtml, { decodeEntities: false });
    const suffix = SUFFIX[lang];
    const expectedTitle = `${article[`title${suffix}`] || article.titleEn} - Mzu favicondl`;
    const expectedDescription = article[`desc${suffix}`] || article.descEn;
    const expectedCanonical = expectedUrl(article.slug, lang);

    const actualTitle = $('head title').first().text().trim();
    const actualDescription = $('meta[name="description"]').attr('content') || '';
    const actualCanonical = $('link[rel="canonical"]').attr('href') || '';

    if (actualTitle !== expectedTitle) fail(`${relativeFile}: localized title mismatch`);
    if (actualDescription !== expectedDescription) fail(`${relativeFile}: localized description mismatch`);
    if (actualCanonical !== expectedCanonical) fail(`${relativeFile}: canonical mismatch`);
    addUnique(titles, actualTitle, 'title', relativeFile);
    addUnique(descriptions, actualDescription, 'description', relativeFile);

    if ($('html').attr('lang') !== SCHEMA_LANG[lang]?.replace('-CN', '') && !(lang === 'zh' && $('html').attr('lang') === 'zh')) {
      fail(`${relativeFile}: html lang mismatch`);
    }
    if ($('link[rel="alternate"][hreflang]').length !== 6) {
      fail(`${relativeFile}: must contain six hreflang alternatives`);
    }
    const robots = $('meta[name="robots"]').attr('content') || '';
    if (!NOINDEX_SLUGS.has(article.slug) && robots.includes('noindex')) {
      fail(`${relativeFile}: indexable article unexpectedly has noindex`);
    }

    const bodyCount = $('.article-body').length;
    const templateCount = $('template[data-article-lang]').length;
    if (NOINDEX_SLUGS.has(article.slug)) {
      const robots = $('meta[name="robots"]').attr('content') || '';
      if (!robots.includes('noindex')) fail(`${relativeFile}: damaged article must remain noindex`);
    } else if (lang === 'en') {
      if (bodyCount !== 1 || templateCount !== 4) {
        fail(`${relativeFile}: English source must have 1 visible body and 4 translation templates`);
      }
    } else if (bodyCount !== 1 || templateCount !== 0) {
      fail(`${relativeFile}: localized page must contain exactly 1 body and no translation templates`);
    }

    const visibleBody = $('.article-body').first();
    if (visibleBody.text().replace(/\s+/g, ' ').trim().length < 200) {
      fail(`${relativeFile}: visible article body is missing or too short`);
    }
    if (!visibleBody.find('h2, h3').length || !visibleBody.find('p').length) {
      fail(`${relativeFile}: visible article body lacks headings or paragraphs`);
    }
    if (visibleBody.find(PAGE_LEVEL_TAGS).length) {
      fail(`${relativeFile}: page-level or unsafe tag found inside article body`);
    }
    if (ENCODED_STRUCTURE.test(visibleBody.html() || '')) {
      fail(`${relativeFile}: encoded structural HTML found in visible article body`);
    }
    const badLinks = visibleBody.find('a[href=""], a[href="#"], a:not([href])').length;
    if (badLinks || visibleBody.find('a[href^="javascript:"]').length) {
      fail(`${relativeFile}: empty, placeholder, or javascript link found in article body`);
    }

    const hrefs = $('a[href]').map((_, el) => $(el).attr('href')).get();
    if (hrefs.some((href) => /^\/(zh|ja|ko|es)\/(zh|ja|ko|es)\//.test(href || ''))) {
      fail(`${relativeFile}: nested language prefix found`);
    }

    const jsonLdNode = $('script[type="application/ld+json"]').first();
    if (!jsonLdNode.length) {
      fail(`${relativeFile}: JSON-LD missing`);
    } else {
      try {
        const jsonLd = JSON.parse(jsonLdNode.html());
        if (jsonLd.headline !== (article[`title${suffix}`] || article.titleEn)) {
          fail(`${relativeFile}: JSON-LD headline mismatch`);
        }
        if (jsonLd.description !== expectedDescription) {
          fail(`${relativeFile}: JSON-LD description mismatch`);
        }
        if (jsonLd.mainEntityOfPage !== expectedCanonical) {
          fail(`${relativeFile}: JSON-LD URL mismatch`);
        }
        if (jsonLd.inLanguage !== SCHEMA_LANG[lang]) {
          fail(`${relativeFile}: JSON-LD language mismatch`);
        }
      } catch (error) {
        fail(`${relativeFile}: invalid JSON-LD (${error.message})`);
      }
    }
  }
}

for (const lang of LANGUAGES.filter((value) => value !== 'en')) {
  const file = path.join(ROOT, lang, 'blog', 'index.html');
  const $ = load(fs.readFileSync(file, 'utf-8'));
  const expectedCanonical = `${DOMAIN}/${lang}/blog/`;
  if ($('link[rel="canonical"]').attr('href') !== expectedCanonical) {
    fail(`${lang}/blog/index.html: canonical must be ${expectedCanonical}`);
  }
}

for (const lang of LANGUAGES) {
  for (const page of CORE_PAGES) {
    const file = lang === 'en'
      ? path.join(ROOT, page)
      : path.join(ROOT, lang, page);
    const relativeFile = path.relative(ROOT, file).replaceAll('\\', '/');
    const $ = load(fs.readFileSync(file, 'utf-8'), { decodeEntities: false });
    const pagePath = page === 'index.html'
      ? '/'
      : page.endsWith('/index.html')
        ? `/${page.replace('/index.html', '/')}`
        : `/${page}`;
    const expectedCanonical = `${DOMAIN}${lang === 'en' ? '' : `/${lang}`}${pagePath}`;
    if ($('link[rel="canonical"]').attr('href') !== expectedCanonical) {
      fail(`${relativeFile}: canonical must be ${expectedCanonical}`);
    }
    if ($('link[rel="alternate"][hreflang]').length !== 6) {
      fail(`${relativeFile}: must contain six hreflang alternatives`);
    }
  }

  const notFoundFile = lang === 'en'
    ? path.join(ROOT, '404.html')
    : path.join(ROOT, lang, '404.html');
  const notFoundRelative = path.relative(ROOT, notFoundFile).replaceAll('\\', '/');
  const notFound = load(fs.readFileSync(notFoundFile, 'utf-8'), { decodeEntities: false });
  if (!(notFound('meta[name="robots"]').attr('content') || '').includes('noindex')) {
    fail(`${notFoundRelative}: 404 page must be noindex`);
  }
  if (notFound('link[rel="canonical"], link[rel="alternate"][hreflang]').length !== 0) {
    fail(`${notFoundRelative}: 404 page must not declare canonical or hreflang`);
  }
}

const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf-8');
for (const slug of NOINDEX_SLUGS) {
  if (sitemap.includes(`/blog/${slug}.html`)) {
    fail(`sitemap.xml: noindex article ${slug} must not be included`);
  }
}

if (errors.length) {
  console.error(`❌ i18n validation failed with ${errors.length} error(s):`);
  for (const error of errors.slice(0, 100)) console.error(`- ${error}`);
  if (errors.length > 100) console.error(`...and ${errors.length - 100} more`);
  process.exit(1);
}

console.log(
  `✅ Validated ${articles.length * LANGUAGES.length} article pages plus core/404 pages: unique metadata, canonical URLs, hreflang, single-language output, JSON-LD and noindex policy.`
);

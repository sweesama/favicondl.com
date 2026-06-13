# FaviconDL 博客关键词调研记录

## 调研目标

为 `blog/queue.json` 补充更高质量、更有真实需求支撑的 SEO 关键词，避免只凭想象补词。

## 数据来源

### 竞品和工具站页面

- RealFaviconGenerator：覆盖 `favicon.ico`、PNG favicon、SVG favicon、Apple Touch Icon、Web App Manifest、兼容性测试等主题。
- Favicon.io：覆盖 image to favicon、text favicon、emoji favicon、PNG/JPG/BMP to ICO、HTML link tags、favicon checker 等主题。
- ConvertICO：覆盖从任意网站提取 favicon、下载 ICO/PNG/SVG/Apple Touch Icon 等工具型需求。
- Canva favicon generator：覆盖品牌识别、在线生成 favicon、设计型用户需求。

### 官方文档和平台帮助

- Next.js 官方文档：`favicon`、`icon`、`apple-icon`、App Router metadata files。
- Wix Help：添加 favicon、发布后才能生效、Google 搜索结果显示不保证。
- Squarespace Help：browser icon、Google 搜索结果 favicon 要求，尤其是 48px 倍数规则。

### 用户问题和社区讨论

- Shopify Community：用户频繁询问 favicon 为什么不显示在 Google 搜索结果。
- Squarespace Forum：用户频繁询问浏览器中显示但 Google 搜索结果不显示。
- Reddit / Vite 相关讨论：Vite 项目 favicon 放在哪里、public folder 如何引用。
- SEOptimer 故障排查文章：缓存、路径错误、HTML 语法错误、link 标签位置错误、本地文件不显示、平台特殊问题。

## 筛选原则

- 优先选择和 FaviconDL 工具强相关的词：生成、下载、提取、检查、转换。
- 优先选择有明确问题意图的词：not showing、not updating、Google results、wrong path、cache。
- 优先选择平台型教程词：Next.js、Vite、SvelteKit、Nuxt、Wix、Squarespace、Shopify、Webflow。
- 优先选择官方和竞品页面中反复出现的实体词：Apple Touch Icon、Web App Manifest、SVG favicon、ICO fallback、link rel icon。
- 避免和 `articles.json`、`queue.json` 里已有 slug 重复。

## 质量判断

这批关键词不是付费 SEO 工具导出的搜索量数据，因此没有精确月搜索量和 KD 分数；但它们有以下真实需求支撑：

- 搜索结果中存在专门页面或竞品工具页面。
- 官方文档有对应主题。
- 社区论坛中有真实用户提问。
- 与 FaviconDL 的产品能力直接匹配，便于文章内自然引导到工具页。

## 后续建议

如果需要更精确的数据，可以再接入 Ahrefs、Semrush、Google Keyword Planner 或 Google Search Console，补充每个关键词的搜索量、竞争度和点击潜力。

# Mzu favicondl - 即时网站图标获取器

一个免费、快速、零成本的网站图标工具：主打“输入网址/域名 -> 抓取并下载 favicon（也可当作网站 logo 图标使用）”，并提供图片转 favicon 的工具页能力。

## 🌟 功能特点

### 主页 - Favicon Extractor / Downloader（主路线）
- ✅ 输入任意域名/网址，即时预览网站图标
- ✅ 支持多尺寸预览与下载（16/32/48/64/128）
- ✅ 一键复制 Direct URL 与 HTML 代码片段
- ✅ 支持下载 PNG，并可选“透明化处理”（实验）
- ✅ 对强保护站点支持“图标覆盖表”秒出（用于 chatgpt.com 等）
- ✅ 默认启用 Cloudflare Worker：更稳定的 HTML 解析与图标发现（含 manifest / apple-touch-icon）
- ✅ 中英文切换

### 工具页面 - 图片转Favicon
- ✅ 拖拽上传图片（支持PNG、JPG、SVG、GIF、WebP）
- ✅ 自动生成多种标准尺寸：
  - 16x16 - 浏览器标签页
  - 32x32 - 标准尺寸
  - 180x180 - Apple Touch Icon
  - 192x192 - Android Chrome
  - 512x512 - Android Chrome HD
- ✅ ZIP打包下载（包含所有尺寸 + manifest.json + HTML代码）
- ✅ 单个尺寸独立下载

### 批量处理
- ✅ 批量获取多个网站的Favicon
- ✅ 支持最多100个域名
- ✅ 批量ZIP打包下载

### 格式转换
- ✅ 支持PNG、JPG、ICO格式转换
- ✅ 自定义输出尺寸

## 🛠️ 技术栈

- **前端框架**: 纯HTML5 + CSS3 + JavaScript (ES6+)
- **样式**: Tailwind CSS (CDN)
- **动画**: Anime.js
- **图片处理**: Canvas API (纯前端处理)
- **ZIP打包**: JSZip (按需加载)
- **图标发现/代理**: Cloudflare Worker（解析 HTML/manifest 并提供图片代理以绕过 CORS）
- **兜底来源**: Google Favicon Service / DuckDuckGo / 直连常见路径

## 💰 成本分析

| 项目 | 方案 | 成本 |
|------|------|------|
| 托管 | Netlify / Vercel / GitHub Pages | **$0** |
| Favicon API | Google Favicon Service | **$0** |
| 图片处理 | 前端Canvas处理 | **$0** |
| CDN | Cloudflare (可选) | **$0** |
| **总计** | | **$0/月** |

## 📁 项目结构

```
favicon/
├── index.html              # 主页 - Favicon获取器
├── tools.html              # 工具页面
├── documentation.html      # API文档页面
├── privacy.html            # 隐私政策
├── 404.html                # 404 错误页面
├── main.js                 # 主页 JavaScript
├── tools.js                # 工具页 JavaScript
├── cloudflare-worker.js    # Cloudflare Worker 源码（单独部署）
├── favicon.svg             # 网站自己的 favicon
├── robots.txt              # 搜索引擎爬取指引
├── sitemap.xml             # 站点地图
├── README.md               # 项目说明
├── design.md               # 设计文档
├── project.md              # 项目计划
└── interaction.md          # 交互设计
```

## 🚀 部署方式

### 方式1: Netlify (推荐)
1. 将项目上传到GitHub
2. 登录 [Netlify](https://netlify.com)
3. 点击 "New site from Git"
4. 选择仓库，自动部署

### 方式2: Vercel
1. 将项目上传到 GitHub
2. 登录 [Vercel](https://vercel.com)
3. 点击 "Add New" -> "Project"，选择你的仓库
4. Framework 选择 "Other"（这是纯静态站）
5. Build Command 留空，Output Directory 留空
6. 点击 Deploy

### 方式3: GitHub Pages
1. 在仓库设置中启用 GitHub Pages
2. 选择 main 分支作为源

### 方式4: 本地运行
```bash
# 使用任意静态服务器，例如：
npx serve .
# 或
python -m http.server 8080
```

## 📖 使用说明

### 获取网站Favicon
1. 在主页输入框中输入域名（如：google.com）
2. 系统自动获取并显示图标预览
3. 点击"复制"获取URL或HTML代码
4. 点击"下载图标"保存到本地

### 图片转Favicon
1. 进入"工具"页面
2. 点击"图片转Favicon"
3. 拖拽或选择图片上传
4. 选择需要的尺寸
5. 点击"下载ZIP包"获取所有文件

### 批量获取
1. 进入"工具"页面
2. 点击"批量处理"
3. 输入域名列表（每行一个）
4. 点击"开始批量处理"
5. 下载结果

## 🔧 API说明

页面中的 "Docs" 是对 URL 模板与复制片段的说明。

### 默认模式（推荐）：通过 Cloudflare Worker 获取更真实的图标

Worker 会：
- 抓取网站 HTML 并解析 `<link rel="icon">` / `apple-touch-icon` / `manifest.webmanifest` 等
- 返回一个 `iconUrl`（真实候选）与 `proxyUrl`（用于绕过浏览器跨域下载）

### 兜底模式：Google Favicon Service

当站点无法解析或被强防护时，会回退到 Google 等聚合源用于“快速预览/可用性兜底”。

URL 模板示例（Google）：

```
https://www.google.com/s2/favicons?domain={域名}&sz={尺寸}
```

参数说明：
- `domain`: 目标网站域名
- `sz`: 图标尺寸（16、32、64、128等）

## 📝 更新日志

### v1.2.0 (2026-02)
- ✅ 语言切换 UI 产品化：下拉菜单 + Twemoji 国旗图片
- ✅ 修复语言跨页面持久化（全局 click 拦截器 + localStorage/URL 双通道）
- ✅ 缓存破除机制（JS 文件加版本参数）
- ✅ 新增 SEO：OG 标签、Twitter Card、canonical URL、robots.txt、sitemap.xml
- ✅ 新增网站 favicon（SVG）
- ✅ 新增隐私政策页 + 404 错误页
- ✅ Google Analytics 代码占位（待启用）
- ✅ 版权年份更新至 2026

### v1.1.0 (2026-01)
- ✅ Cloudflare Worker 图标发现优化（候选上限 + 提前停止策略）
- ✅ 修复批量 ZIP 下载 CORS 问题（通过 Worker 代理）
- ✅ 图标卡片垂直居中优化
- ✅ 批量处理命名模式（域名 / 索引）

### v1.0.0 (2024-12)
- ✅ 完成主页 Favicon 获取功能
- ✅ 完成图片转 Favicon 工具
- ✅ 完成批量处理功能
- ✅ 完成 ZIP 打包下载
- ✅ 完成 manifest.json 生成
- ✅ 完成 HTML 代码生成

## 📄 许可证

MIT License

## 🙏 致谢

- [Google Favicon Service](https://www.google.com/s2/favicons) - 免费Favicon API
- [Tailwind CSS](https://tailwindcss.com) - CSS框架
- [Anime.js](https://animejs.com) - 动画库
- [JSZip](https://stuk.github.io/jszip/) - ZIP生成库

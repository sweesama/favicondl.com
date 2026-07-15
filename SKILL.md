---
name: favicondl
displayName: 任意网站 Favicon 下载工具 · FaviconDL
description: 通过 HTTPS API 或零依赖 CLI 下载任意网站的可用 favicon，支持尺寸偏好、图片重定向、JSON 元数据和 Windows/Linux/macOS。
version: 2.0.0
---

# FaviconDL

FaviconDL provides a stable REST API and two small command-line wrappers for finding a usable favicon from a domain or full URL.

## What it supports

- Prefer an icon size from 16 to 512 pixels.
- Resolve icons from HTML links, SVG, Apple Touch Icons, web manifests, Android assets, and safe fallback sources.
- Return a downloadable image through HTTP 302 or return JSON metadata.
- Proxy remote images through a protected Worker when direct downloads are not reliable.
- Reject unsupported protocols, private-network targets, oversized proxy responses, and non-image responses.
- Use the API from any agent that can make an HTTPS GET request.

The returned image format is determined by the source site. Do not assume every result is PNG; SVG, PNG, ICO, and WebP are possible.

## Install the CLI wrappers

### Windows PowerShell

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/sweesama/favicondl.com/main/favicondl.ps1" -OutFile "$env:USERPROFILE\favicondl.ps1"
```

### Linux or macOS

```bash
curl -fsSL -o ~/favicondl.sh "https://raw.githubusercontent.com/sweesama/favicondl.com/main/favicondl.sh"
chmod +x ~/favicondl.sh
```

The wrappers need only PowerShell or curl. They do not need an API key or a package manager.

## CLI usage

### PowerShell

```powershell
.\favicondl.ps1 -Domain "github.com"
.\favicondl.ps1 -Domain "github.com" -Size 256
.\favicondl.ps1 -Domain "github.com" -Size 128 -Output "C:\icons\github.img"
.\favicondl.ps1 -Domain "github.com", "openai.com", "anthropic.com" -Output "C:\icons"
```

### Bash

```bash
./favicondl.sh github.com
./favicondl.sh github.com 256
./favicondl.sh https://github.com/docs 128 ./icons/github.img
```

The output is an image file. The `.img` suffix is intentional because the source site controls the actual image format.

## REST API

### Download mode

```text
GET https://favicondl.com/api/extract?url=github.com&size=128
```

The default response is `302 Found`. Follow the redirect to download the image.

```bash
curl -fL -o github-favicon.img "https://favicondl.com/api/extract?url=github.com&size=128"
```

### JSON mode

```text
GET https://favicondl.com/api/extract?url=github.com&size=128&format=json
```

The JSON response contains `ok`, `domain`, `size`, `iconUrl`, `proxyUrl`, and `source`.

```json
{
  "ok": true,
  "domain": "github.com",
  "size": 128,
  "iconUrl": "https://github.com/favicon.ico",
  "proxyUrl": "https://favicondl.com/api/proxy?url=...",
  "source": "html"
}
```

### Parameters

| Parameter | Required | Default | Description |
|---|---:|---:|---|
| `url` | yes | — | Domain or full HTTP(S) URL |
| `size` | no | `128` | Preferred size, clamped to `16`–`512` |
| `format` | no | `redirect` | Use `json` for metadata; otherwise receive a 302 image redirect |

## Agent guidance

Use `/api/extract` as the canonical endpoint. Use `format=json` when the agent needs to inspect the source or choose between `iconUrl` and `proxyUrl`. Use the default redirect mode when the agent only needs to download or embed the image.

The project also publishes:

- OpenAPI: `https://favicondl.com/openapi.yaml`
- Agent guide: `https://favicondl.com/llms.txt`
- Human documentation: `https://favicondl.com/documentation.html`

This project exposes a REST API, OpenAPI description, `llms.txt`, CLI wrappers, and a local stdio MCP server under `mcp/server.mjs`. The MCP server exposes `extract_favicon` and delegates to the public REST API. It is a local MCP process, not a hosted remote MCP endpoint.

## Errors

- `400`: missing URL or unsupported format.
- `502`: icon discovery failed or no usable image URL was returned.
- `504`: the extraction or upstream request timed out.
- `405`: the API method is not GET.

Retry temporary `502` or `504` errors with backoff. Do not silently switch to an unrelated third-party favicon service; the API already performs its own discovery and safe fallback logic.

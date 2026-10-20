# FaviconDL MCP Server

This is a local MCP server for clients that support the Model Context Protocol. It exposes one tool, `extract_favicon`, and delegates discovery to the public FaviconDL API.

## Install

```bash
git clone https://github.com/sweesama/favicondl.com.git
cd favicondl.com/mcp
npm install
```

## Run

```bash
npm start
```

## MCP client configuration

Point your client at `mcp/server.mjs` using its absolute path on your machine. Example:

```json
{
  "mcpServers": {
    "favicondl": {
      "command": "node",
      "args": ["/absolute/path/to/favicondl.com/mcp/server.mjs"]
    }
  }
}
```

The tool accepts:

- `url`: a domain or full HTTP(S) URL
- `size`: optional exact output size from 16 to 512 (for example 16, 32, 64, 128, 256 or 512). Omit it for the original file. A raster smaller than `size` is upscaled and may look soft.

The result contains `ok`, `domain`, `size`, `iconUrl`, `proxyUrl`, and `source`, plus `nativeWidth`, `nativeHeight`, `outputWidth`, `outputHeight`, and `upscaled` when a size was requested. `proxyUrl` is the exact square PNG in that case. `iconUrl` stays the original file.

On Windows, use a path such as `C:/path/to/favicondl.com/mcp/server.mjs`.

This is a local stdio MCP server, not a hosted remote MCP endpoint. It requires no API key and adds no server-side cost beyond the existing public API request.

## Docker

A `Dockerfile` at the repository root builds the server into a small image (used by MCP directories such as Glama):

```bash
docker build -t favicondl-mcp .
docker run -i --rm favicondl-mcp
```

The container speaks MCP over stdio, so run it with `-i`.

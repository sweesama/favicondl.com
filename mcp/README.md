# FaviconDL MCP Server

This is a local MCP server for clients that support the Model Context Protocol. It exposes one tool, `extract_favicon`, and delegates discovery to the public FaviconDL API.

## Install

```bash
cd mcp
npm install
```

## Run

```bash
npm start
```

## MCP client configuration

Use the absolute path to Node and this project's `mcp/server.mjs` file. Example:

```json
{
  "mcpServers": {
    "favicondl": {
      "command": "node",
      "args": ["F:/windsurf/favicon/mcp/server.mjs"]
    }
  }
}
```

The tool accepts:

- `url`: a domain or full HTTP(S) URL
- `size`: an optional preferred size from 16 to 512

The result contains `ok`, `domain`, `size`, `iconUrl`, `proxyUrl`, and `source`.

This is a local stdio MCP server, not a hosted remote MCP endpoint. It requires no API key and adds no server-side cost beyond the existing public API request.

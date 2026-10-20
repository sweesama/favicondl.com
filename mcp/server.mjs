import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_ENDPOINT = 'https://favicondl.com/api/extract';
const MIN_SIZE = 16;
const MAX_SIZE = 512;
const REQUEST_TIMEOUT_MS = 15000;

const server = new Server(
  { name: 'favicondl', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'extract_favicon',
      description: 'Find a usable favicon for a domain or URL. Pass size (16-512, for example 32) for an exact square PNG. Omit size for the original file. Upscaled rasters may look soft.',
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'A domain or full HTTP(S) URL, such as github.com or https://github.com/docs.',
          },
          size: {
            type: 'integer',
            minimum: MIN_SIZE,
            maximum: MAX_SIZE,
            description: 'Exact output size in pixels, from 16 to 512 (for example 16, 32, 64, 128, 256 or 512). Omit it to receive the original file. A raster smaller than this size is upscaled and may look soft.',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'extract_favicon') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const input = request.params.arguments || {};
  const target = String(input.url || '').trim();
  if (!target) {
    return toolError('The url argument is required.');
  }

  const size = clampSize(input.size);
  const endpoint = new URL(API_ENDPOINT);
  endpoint.searchParams.set('url', target);
  endpoint.searchParams.set('format', 'json');
  if (size !== null) endpoint.searchParams.set('size', String(size));

  try {
    const response = await fetchWithTimeout(endpoint);
    const data = await response.json();
    if (!response.ok || !data?.ok) {
      return toolError(data?.error || `Favicon extraction failed with HTTP ${response.status}.`);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Favicon extraction failed.');
  }
});

function clampSize(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(parsed)));
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function toolError(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

await server.connect(new StdioServerTransport());

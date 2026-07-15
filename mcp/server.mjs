import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_ENDPOINT = 'https://favicondl.com/api/extract';
const DEFAULT_SIZE = 128;
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
      description: 'Find a usable favicon for a domain or URL and return image URLs plus source metadata.',
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
            default: DEFAULT_SIZE,
            description: 'Preferred icon size in pixels.',
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
  endpoint.searchParams.set('size', String(size));
  endpoint.searchParams.set('format', 'json');

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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_SIZE;
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

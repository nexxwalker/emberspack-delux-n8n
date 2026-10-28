#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Resolve Google Drive share/view URLs to direct download form
function resolveUrl(url) {
  // https://drive.google.com/file/d/FILE_ID/view → convert to uc?export=view
  const fileView = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (fileView) return `https://drive.google.com/uc?export=view&id=${fileView[1]}`;
  return url;
}

const MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function guessMime(url, contentType) {
  if (contentType && contentType.startsWith('image/')) return contentType.split(';')[0].trim();
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  return MIME_TYPES[ext] || 'image/jpeg';
}

const TOOLS = [
  {
    name: 'view_image',
    description: [
      'Fetch an image from any public URL (including Google Drive uc?export=view links) and return it',
      "as a base64-encoded image block that Claude's vision can see.",
      'Use this whenever you need to inspect, describe, or reference a reference-folder image.',
      'The tool handles Google Drive share URLs automatically — just pass the URL as-is from the brain notes.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Public image URL. Google Drive uc?export=view&id=... links work directly.',
        },
        label: {
          type: 'string',
          description: 'Optional short label shown alongside the image (e.g. filename or caption).',
        },
      },
      required: ['url'],
    },
  },
];

async function fetchImage(rawUrl) {
  const url = resolveUrl(rawUrl);
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; delux-crew/1.0)' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const contentType = resp.headers.get('content-type') || '';
  // Drive sometimes returns HTML for login-protected files
  if (contentType.includes('text/html')) {
    throw new Error(
      'Got an HTML page instead of an image — the file may not be publicly shared. ' +
        "Share it as 'Anyone with the link can view'.",
    );
  }
  const mimeType = guessMime(url, contentType);
  const buffer = await resp.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, mimeType };
}

async function main() {
  const server = new Server({ name: 'view-image-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    if (name !== 'view_image') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    if (!args.url) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: 'url is required' }) }],
        isError: true,
      };
    }

    try {
      const { base64, mimeType } = await fetchImage(args.url);
      const content = [];
      if (args.label) content.push({ type: 'text', text: args.label });
      content.push({ type: 'image', data: base64, mimeType });
      return { content };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`view-image-mcp crashed: ${err.message}\n`);
  process.exit(1);
});

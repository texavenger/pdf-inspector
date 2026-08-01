import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { inspectPdfSource } from './pdf.mjs';
import { createPdfMcpServer } from './server.mjs';

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const bodyLimit = process.env.JSON_BODY_LIMIT || '35mb';

app.disable('x-powered-by');
app.use(express.json({ limit: bodyLimit }));

function authenticate(req, res, next) {
  const expected = process.env.MCP_API_TOKEN;
  if (!expected) return next();

  const authorization = req.headers.authorization || '';
  if (authorization !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  return next();
}

function validateHost(req, res, next) {
  const configured = process.env.TRUSTED_HOSTS;
  if (!configured) return next();

  const allowed = configured.split(',').map((value) => value.trim().toLowerCase());
  const received = String(req.headers.host || '').split(':')[0].toLowerCase();
  if (!allowed.includes(received)) {
    return res.status(403).json({ error: 'Host não permitido.' });
  }

  return next();
}

app.use(validateHost);

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'pdf-inspector-mcp',
    ocr: 'pdftoppm + tesseract',
    timestamp: new Date().toISOString()
  });
});

app.post('/inspect', authenticate, async (req, res) => {
  try {
    res.json(await inspectPdfSource(req.body));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/mcp', authenticate, async (req, res) => {
  const server = createPdfMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
});

app.get('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'Use POST /mcp.' });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'Servidor MCP sem estado.' });
});

const httpServer = app.listen(port, host, () => {
  console.error(`pdf-inspector-mcp disponível em http://${host}:${port}/mcp`);
});

async function shutdown() {
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

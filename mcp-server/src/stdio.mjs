import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPdfMcpServer } from './server.mjs';

const server = createPdfMcpServer();
const transport = new StdioServerTransport();

await server.connect(transport);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

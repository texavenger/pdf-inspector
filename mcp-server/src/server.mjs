import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { classifyPdfSource, inspectPdfSource } from './pdf.mjs';

const sourceFields = {
  url: z.string().url().optional().describe('URL HTTP/HTTPS pública de um PDF.'),
  base64: z.string().optional().describe('Conteúdo completo do PDF em Base64 ou data URI.'),
  path: z.string().optional().describe('Caminho local relativo ao PDF_ROOT; requer ALLOW_LOCAL_PATHS=true.')
};

function withSingleSource(schema) {
  return schema.refine(
    (value) => [value.url, value.base64, value.path].filter(Boolean).length === 1,
    { message: 'Informe exatamente uma fonte: url, base64 ou path.' }
  );
}

function asTextResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }
    ]
  };
}

function asErrorResult(error) {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error)
      }
    ]
  };
}

export function createPdfMcpServer() {
  const server = new McpServer(
    {
      name: 'pdf-inspector-reader',
      version: '1.0.0'
    },
    {
      instructions:
        'Para qualquer PDF, use inspect_pdf como rota padrão. O pdf-inspector extrai texto nativo e o OCR é usado somente nas páginas sinalizadas. Não invente conteúdo ausente; relate páginas com falha de OCR.'
    }
  );

  server.registerTool(
    'classify_pdf',
    {
      title: 'Classificar PDF',
      description:
        'Classifica rapidamente um PDF como textual, escaneado, baseado em imagens ou misto e informa as páginas que precisam de OCR.',
      inputSchema: withSingleSource(z.object(sourceFields))
    },
    async (input) => {
      try {
        return asTextResult(await classifyPdfSource(input));
      } catch (error) {
        return asErrorResult(error);
      }
    }
  );

  server.registerTool(
    'inspect_pdf',
    {
      title: 'Ler PDF com fallback OCR',
      description:
        'Lê um PDF com pdf-inspector, preserva Markdown, tabelas e ordem de leitura e executa OCR apenas nas páginas necessárias.',
      inputSchema: withSingleSource(
        z.object({
          ...sourceFields,
          ocr: z.boolean().default(true).describe('Executar OCR nas páginas sinalizadas.'),
          ocrLanguage: z.string().default('por+eng').describe('Idiomas do Tesseract, por exemplo por+eng.'),
          ocrDpi: z.number().int().min(100).max(400).default(220),
          maxOutputChars: z.number().int().min(1_000).max(500_000).default(120_000)
        })
      )
    },
    async (input) => {
      try {
        const result = await inspectPdfSource(input);
        const metadata = {
          source: result.source,
          pdfType: result.pdfType,
          pageCount: result.pageCount,
          confidence: result.confidence,
          title: result.title,
          processingTimeMs: result.processingTimeMs,
          sizeBytes: result.sizeBytes,
          pagesNeedingOcr: result.pagesNeedingOcr,
          ocrReasonsByPage: result.ocrReasonsByPage,
          pagesWithTables: result.pagesWithTables,
          pagesWithColumns: result.pagesWithColumns,
          isComplexLayout: result.isComplexLayout,
          hasEncodingIssues: result.hasEncodingIssues,
          ocrEnabled: result.ocrEnabled,
          ocrFailures: result.ocrPages.filter((page) => page.error),
          truncated: result.truncated
        };

        return asTextResult(
          `METADADOS\n${JSON.stringify(metadata, null, 2)}\n\nCONTEÚDO EM MARKDOWN\n${result.markdown}`
        );
      } catch (error) {
        return asErrorResult(error);
      }
    }
  );

  return server;
}

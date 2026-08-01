import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { classifyPdf, processPdf } from '@firecrawl/pdf-inspector';
import {
  assertSafeRemoteUrl,
  requireExactlyOneSource,
  resolveSandboxedPath
} from './security.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT = 120_000;
const MAX_REDIRECTS = 5;

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function maxPdfBytes() {
  return asPositiveInteger(process.env.MAX_PDF_BYTES, DEFAULT_MAX_BYTES);
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('O PDF está vazio.');
  }

  if (buffer.length > maxPdfBytes()) {
    throw new Error(`O PDF excede o limite de ${maxPdfBytes()} bytes.`);
  }

  const header = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!header.includes('%PDF-')) {
    throw new Error('O arquivo recebido não possui um cabeçalho PDF válido.');
  }
}

async function downloadPdf(initialUrl) {
  let currentUrl = initialUrl;
  const allowPrivate = process.env.ALLOW_PRIVATE_URLS === 'true';

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const safeUrl = await assertSafeRemoteUrl(currentUrl, { allowPrivate });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    let response;
    try {
      response = await fetch(safeUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'pdf-inspector-mcp/1.0'
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirecionamento sem cabeçalho Location.');
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Falha ao baixar o PDF: HTTP ${response.status}.`);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maxPdfBytes()) {
      throw new Error(`O PDF excede o limite de ${maxPdfBytes()} bytes.`);
    }

    if (!response.body) throw new Error('A resposta não contém corpo.');

    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > maxPdfBytes()) {
        throw new Error(`O PDF excede o limite de ${maxPdfBytes()} bytes.`);
      }
      chunks.push(buffer);
    }

    const pdf = Buffer.concat(chunks);
    assertPdfBuffer(pdf);
    return { buffer: pdf, sourceLabel: safeUrl.toString() };
  }

  throw new Error(`Número máximo de redirecionamentos excedido (${MAX_REDIRECTS}).`);
}

function decodeBase64(value) {
  const normalized = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const compact = normalized.replace(/\s+/g, '');
  const buffer = Buffer.from(compact, 'base64');
  assertPdfBuffer(buffer);
  return buffer;
}

export async function loadPdfSource(input) {
  requireExactlyOneSource(input);

  if (input.url) return downloadPdf(input.url);

  if (input.base64) {
    return { buffer: decodeBase64(input.base64), sourceLabel: 'base64' };
  }

  if (process.env.ALLOW_LOCAL_PATHS !== 'true') {
    throw new Error('Leitura por caminho local está desativada. Defina ALLOW_LOCAL_PATHS=true.');
  }

  const root = process.env.PDF_ROOT || process.cwd();
  const resolved = resolveSandboxedPath(input.path, root);
  const buffer = await readFile(resolved);
  assertPdfBuffer(buffer);
  return { buffer, sourceLabel: resolved };
}

function normalizeOcrLanguage(language) {
  const value = String(language || process.env.OCR_LANG || 'por+eng');
  if (!/^[A-Za-z0-9_+.-]+$/.test(value)) {
    throw new Error('Idioma de OCR inválido.');
  }
  return value;
}

async function runOcr(buffer, pages, options = {}) {
  if (pages.length === 0) return [];

  const language = normalizeOcrLanguage(options.language);
  const dpi = Math.min(400, Math.max(100, asPositiveInteger(options.dpi, 220)));
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'pdf-inspector-'));
  const pdfPath = path.join(tempDirectory, 'document.pdf');
  await writeFile(pdfPath, buffer);

  try {
    const outputs = [];

    for (const pageNumber of pages) {
      const prefix = path.join(tempDirectory, `page-${pageNumber}`);
      const imagePath = `${prefix}.png`;

      try {
        await execFileAsync(
          'pdftoppm',
          ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-png', '-r', String(dpi), pdfPath, prefix],
          { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }
        );

        const { stdout } = await execFileAsync(
          'tesseract',
          [imagePath, 'stdout', '-l', language, '--psm', '3'],
          { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }
        );

        outputs.push({ page: pageNumber, text: stdout.trim(), error: null });
      } catch (error) {
        outputs.push({
          page: pageNumber,
          text: '',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return outputs;
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function buildCombinedMarkdown(nativeMarkdown, ocrPages) {
  const sections = [];
  if (nativeMarkdown?.trim()) sections.push(nativeMarkdown.trim());

  const usableOcr = ocrPages.filter((page) => page.text);
  if (usableOcr.length > 0) {
    sections.push(
      ['# Páginas recuperadas por OCR', ...usableOcr.map((page) => `## Página ${page.page}\n\n${page.text}`)].join('\n\n')
    );
  }

  return sections.join('\n\n---\n\n');
}

function truncate(text, requestedLimit) {
  const limit = Math.min(500_000, asPositiveInteger(requestedLimit, DEFAULT_MAX_OUTPUT));
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n[SAÍDA TRUNCADA EM ${limit} CARACTERES]`,
    truncated: true
  };
}

export async function classifyPdfSource(input) {
  const { buffer, sourceLabel } = await loadPdfSource(input);
  const result = classifyPdf(buffer);

  return {
    source: sourceLabel,
    pdfType: result.pdfType,
    pageCount: result.pageCount,
    pagesNeedingOcrZeroIndexed: result.pagesNeedingOcr,
    pagesNeedingOcr: result.pagesNeedingOcr.map((page) => page + 1),
    confidence: result.confidence,
    sizeBytes: buffer.length
  };
}

export async function inspectPdfSource(input) {
  const { buffer, sourceLabel } = await loadPdfSource(input);
  const native = processPdf(buffer);
  const pagesNeedingOcr = native.pagesNeedingOcr ?? [];
  const shouldOcr = input.ocr !== false;
  const ocrPages = shouldOcr
    ? await runOcr(buffer, pagesNeedingOcr, {
        language: input.ocrLanguage,
        dpi: input.ocrDpi
      })
    : [];

  const combined = buildCombinedMarkdown(native.markdown ?? '', ocrPages);
  const limited = truncate(combined, input.maxOutputChars);

  return {
    source: sourceLabel,
    pdfType: native.pdfType,
    pageCount: native.pageCount,
    confidence: native.confidence,
    title: native.title ?? null,
    processingTimeMs: native.processingTimeMs,
    sizeBytes: buffer.length,
    pagesNeedingOcr,
    ocrReasonsByPage: native.ocrReasonsByPage ?? [],
    pagesWithTables: native.pagesWithTables ?? [],
    pagesWithColumns: native.pagesWithColumns ?? [],
    isComplexLayout: native.isComplexLayout ?? false,
    hasEncodingIssues: native.hasEncodingIssues ?? false,
    ocrEnabled: shouldOcr,
    ocrPages,
    markdown: limited.text,
    truncated: limited.truncated
  };
}

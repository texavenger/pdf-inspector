# PDF Inspector MCP

Camada MCP e HTTP para usar o `pdf-inspector` como leitor padrão de PDFs, com OCR seletivo para páginas escaneadas.

## O que esta integração faz

1. Recebe um PDF por URL pública, Base64 ou caminho local autorizado.
2. Usa `@firecrawl/pdf-inspector` para classificação, extração estrutural e Markdown.
3. Lê `pagesNeedingOcr`.
4. Renderiza somente essas páginas com Poppler.
5. Executa Tesseract em português e inglês.
6. Devolve metadados, Markdown nativo e páginas recuperadas por OCR.

Ferramentas MCP expostas:

- `classify_pdf`: classificação rápida e roteamento de OCR.
- `inspect_pdf`: leitura completa com OCR seletivo.

## Execução com Docker

```bash
cd mcp-server
cp .env.example .env
# edite MCP_API_TOKEN no arquivo .env
docker compose up --build -d
```

Teste de saúde:

```bash
curl http://localhost:3000/health
```

Teste da API HTTP:

```bash
curl -X POST http://localhost:3000/inspect \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://exemplo.com/documento.pdf","ocr":true}'
```

Endpoint MCP remoto:

```text
https://SEU-DOMINIO/mcp
```

Use autenticação Bearer com o valor de `MCP_API_TOKEN`.

## Execução local por stdio

```bash
cd mcp-server
npm install
ALLOW_LOCAL_PATHS=true PDF_ROOT=/caminho/dos/pdfs npm run start:stdio
```

Exemplo de configuração de cliente MCP local:

```json
{
  "mcpServers": {
    "pdf-inspector": {
      "command": "npm",
      "args": ["run", "start:stdio"],
      "cwd": "/caminho/pdf-inspector/mcp-server",
      "env": {
        "ALLOW_LOCAL_PATHS": "true",
        "PDF_ROOT": "/caminho/dos/pdfs",
        "OCR_LANG": "por+eng"
      }
    }
  }
}
```

## Segurança

- URLs privadas, loopback, link-local e faixas reservadas são bloqueadas por padrão para reduzir SSRF.
- Redirecionamentos são verificados novamente.
- O tamanho máximo padrão é 25 MiB.
- Caminhos locais ficam desativados até `ALLOW_LOCAL_PATHS=true`.
- Quando caminhos locais são habilitados, todos permanecem confinados em `PDF_ROOT`.
- Configure `MCP_API_TOKEN` antes de publicar o endpoint.

## Variáveis de ambiente

| Variável | Padrão | Finalidade |
|---|---:|---|
| `PORT` | `3000` | Porta HTTP |
| `MCP_API_TOKEN` | vazio | Token Bearer; obrigatório em produção |
| `OCR_LANG` | `por+eng` | Idiomas instalados no Tesseract |
| `MAX_PDF_BYTES` | `26214400` | Tamanho máximo do PDF |
| `JSON_BODY_LIMIT` | `35mb` | Limite do corpo JSON/Base64 |
| `ALLOW_PRIVATE_URLS` | `false` | Permitir URLs de rede privada |
| `ALLOW_LOCAL_PATHS` | `false` | Permitir leitura por caminho local |
| `PDF_ROOT` | diretório atual | Raiz permitida para caminhos locais |
| `TRUSTED_HOSTS` | vazio | Lista de hosts HTTP permitidos |

## Limitação do ChatGPT

O servidor não intercepta automaticamente anexos de uma conversa. O cliente MCP precisa fornecer ao tool uma URL, Base64 ou caminho acessível. Para o ChatGPT, o endpoint deve estar remoto ou ser publicado por um túnel MCP compatível. A disponibilidade de apps MCP depende do plano e do modo de desenvolvedor da conta.

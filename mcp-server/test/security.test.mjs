import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isPrivateAddress,
  requireExactlyOneSource,
  resolveSandboxedPath
} from '../src/security.mjs';

test('bloqueia faixas privadas e reservadas', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.1.2.3'), true);
  assert.equal(isPrivateAddress('192.168.1.1'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('::1'), true);
});

test('exige exatamente uma fonte', () => {
  assert.throws(() => requireExactlyOneSource({}), /exatamente uma fonte/i);
  assert.throws(
    () => requireExactlyOneSource({ url: 'https://example.com/a.pdf', base64: 'abc' }),
    /exatamente uma fonte/i
  );
  assert.doesNotThrow(() => requireExactlyOneSource({ path: 'document.pdf' }));
});

test('impede fuga do diretório permitido', () => {
  assert.throws(() => resolveSandboxedPath('../segredo.pdf', '/tmp/pdfs'), /fora do diretório/i);
  assert.equal(resolveSandboxedPath('docs/a.pdf', '/tmp/pdfs'), '/tmp/pdfs/docs/a.pdf');
});

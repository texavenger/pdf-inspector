import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import path from 'node:path';

function ipv4ToNumber(address) {
  return address
    .split('.')
    .map(Number)
    .reduce((value, octet) => ((value << 8) | octet) >>> 0, 0);
}

function inIpv4Range(address, base, prefix) {
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & bits) === (ipv4ToNumber(base) & bits);
}

export function isPrivateAddress(address) {
  const version = isIP(address);

  if (version === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4]
    ].some(([base, prefix]) => inIpv4Range(address, base, prefix));
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.')
    );
  }

  return true;
}

async function resolveHost(hostname) {
  if (isIP(hostname)) return [hostname];

  const results = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname)
  ]);

  const addresses = results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  );

  if (addresses.length === 0) {
    throw new Error(`Não foi possível resolver o host: ${hostname}`);
  }

  return addresses;
}

export async function assertSafeRemoteUrl(value, options = {}) {
  const allowPrivate = options.allowPrivate === true;
  const url = new URL(value);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Somente URLs HTTP ou HTTPS são permitidas.');
  }

  if (url.username || url.password) {
    throw new Error('URLs com usuário ou senha embutidos não são permitidas.');
  }

  if (!allowPrivate) {
    const addresses = await resolveHost(url.hostname);
    const blocked = addresses.find(isPrivateAddress);
    if (blocked) {
      throw new Error(`O endereço resolvido não é público: ${blocked}`);
    }
  }

  return url;
}

export function resolveSandboxedPath(value, rootDirectory) {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, value);
  const relative = path.relative(root, target);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('O caminho solicitado está fora do diretório permitido.');
  }

  return target;
}

export function requireExactlyOneSource({ url, base64, path: localPath }) {
  const count = [url, base64, localPath].filter(
    (value) => typeof value === 'string' && value.length > 0
  ).length;

  if (count !== 1) {
    throw new Error('Informe exatamente uma fonte: url, base64 ou path.');
  }
}

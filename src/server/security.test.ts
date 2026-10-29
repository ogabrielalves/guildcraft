import { describe, expect, it } from 'vitest';
import {
  allowedOrigins,
  createToken,
  isAllowedOrigin,
  isLoopbackHost,
  launchUrl,
  tokenFromUrl,
  tokensMatch,
} from './security.js';

describe('createToken', () => {
  it('creates distinct url-safe 32-byte tokens', () => {
    const token = createToken();
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(createToken()).not.toBe(token);
  });
});

describe('tokensMatch', () => {
  it('accepts the same token', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
  });

  it.each([['abd'], ['ab'], ['abcd'], [''], [undefined], [123]])('rejects %j', (received) => {
    expect(tokensMatch('abc', received)).toBe(false);
  });
});

describe('origins', () => {
  const origins = allowedOrigins(7777);

  it.each(['http://127.0.0.1:7777', 'http://localhost:7777'])('allows %s', (origin) => {
    expect(isAllowedOrigin(origin, origins)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:8080',
    'https://localhost:7777',
    'http://evil.example',
    'null',
    undefined,
  ])('blocks %s', (origin) => {
    expect(isAllowedOrigin(origin, origins)).toBe(false);
  });
});

describe('isLoopbackHost', () => {
  it.each(['127.0.0.1:7777', 'localhost:5173', 'LOCALHOST', '127.0.0.1'])('allows %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    'evil.test:7777',
    'localhost.evil.test',
    '127.0.0.1.nip.io:7777',
    'evil.test@localhost',
    '[::1]:7777',
    '',
    undefined,
  ])('blocks %s', (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe('tokenFromUrl', () => {
  it('reads the token query parameter', () => {
    expect(tokenFromUrl('/ws?token=a%2Bb')).toBe('a+b');
  });

  it.each([undefined, '', '/ws', 'http://[bad'])('returns null for %j', (url) => {
    expect(tokenFromUrl(url)).toBeNull();
  });
});

describe('launchUrl', () => {
  it('points at the loopback address with the token', () => {
    const url = launchUrl(7777, 'a+b');
    expect(url).toBe('http://127.0.0.1:7777/?token=a%2Bb');
    expect(tokenFromUrl(url)).toBe('a+b');
  });
});

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TOKEN_QUERY } from '../shared/constants.js';

export const TOKEN_BYTES = 32;

export function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function tokensMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function allowedOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export function isAllowedOrigin(origin: string | undefined, origins: readonly string[]): boolean {
  return origin !== undefined && origins.includes(origin);
}

export function tokenFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'http://127.0.0.1').searchParams.get(TOKEN_QUERY);
  } catch {
    return null;
  }
}

export function launchUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?${TOKEN_QUERY}=${encodeURIComponent(token)}`;
}

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i;

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOST.test(host);
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

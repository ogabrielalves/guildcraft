import { TOKEN_HEADER } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import { isErrorCode } from '../../shared/errors.js';
import type { FsEntry, FsListing } from '../../shared/fs.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  token: string | null;
  fetch?: FetchLike;
}

export interface Api {
  listFolders(path: string | null): Promise<FsListing>;
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

function isEntry(value: unknown): value is FsEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { name, path } = value as Partial<Record<keyof FsEntry, unknown>>;
  return typeof name === 'string' && typeof path === 'string';
}

function isPathOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isFsListing(value: unknown): value is FsListing {
  if (typeof value !== 'object' || value === null) return false;
  const { path, parent, entries, roots } = value as Partial<Record<keyof FsListing, unknown>>;
  return (
    isPathOrNull(path) &&
    isPathOrNull(parent) &&
    Array.isArray(entries) &&
    entries.every(isEntry) &&
    Array.isArray(roots) &&
    roots.every(isEntry)
  );
}

async function errorCode(response: Response): Promise<ErrorCode> {
  try {
    const body: unknown = await response.json();
    const code =
      typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : null;
    return isErrorCode(code) ? code : 'INVALID_MESSAGE';
  } catch {
    return 'INVALID_MESSAGE';
  }
}

export function createApi(options: ApiOptions): Api {
  const request = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const headers: Record<string, string> = options.token ? { [TOKEN_HEADER]: options.token } : {};

  const getJson = async (url: string): Promise<unknown> => {
    const response = await request(url, { headers });
    if (!response.ok) throw new ApiError(await errorCode(response), response.status);
    return response.json();
  };

  return {
    async listFolders(path) {
      const url = path === null ? '/api/fs' : `/api/fs?path=${encodeURIComponent(path)}`;
      const body = await getJson(url);
      if (!isFsListing(body)) throw new ApiError('INVALID_MESSAGE', 200);
      return body;
    },
  };
}

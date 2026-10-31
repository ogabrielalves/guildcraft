import { TOKEN_HEADER } from '../../shared/constants.js';
import type { ErrorCode } from '../../shared/errors.js';
import { isErrorCode } from '../../shared/errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  token: string | null;
  fetch?: FetchLike;
}

export interface Api {
  pickFolder(initial: string | null): Promise<string | null>;
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

  const postJson = async (url: string, body: unknown): Promise<unknown> => {
    const response = await request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new ApiError(await errorCode(response), response.status);
    return response.json();
  };

  return {
    async pickFolder(initial) {
      const body = await postJson('/api/fs/pick', { path: initial });
      const path =
        typeof body === 'object' && body !== null ? (body as { path?: unknown }).path : undefined;
      if (path === null || typeof path === 'string') return path;
      throw new ApiError('INVALID_MESSAGE', 200);
    },
  };
}

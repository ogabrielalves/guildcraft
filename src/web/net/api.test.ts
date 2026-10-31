import { describe, expect, it, vi } from 'vitest';
import { TOKEN_HEADER } from '../../shared/constants.js';
import { ApiError, createApi } from './api.js';
import type { FetchLike } from './api.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createApi', () => {
  it('asks the server for the native folder dialog with the session token', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json({ path: '/home/me/code' })));
    const api = createApi({ token: 'secret', fetch });
    await expect(api.pickFolder('/home/me')).resolves.toBe('/home/me/code');
    expect(fetch).toHaveBeenCalledWith('/api/fs/pick', {
      method: 'POST',
      headers: { [TOKEN_HEADER]: 'secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/home/me' }),
    });
  });

  it('sends no token header without a token and resolves null when cancelled', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json({ path: null })));
    await expect(createApi({ token: null, fetch }).pickFolder(null)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/fs/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: null }),
    });
  });

  it('turns server errors into ApiError with the error code', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json({ code: 'SPAWN_FAILED' }, 400)));
    const error: unknown = await createApi({ token: 't', fetch })
      .pickFolder(null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'SPAWN_FAILED', status: 400, name: 'ApiError' });
  });

  it.each([
    ['an unknown code', json({ code: 'NOPE' }, 500)],
    ['a non-object body', json('oops', 500)],
    ['a body that is not json', new Response('<html>', { status: 502 })],
  ])('falls back to INVALID_MESSAGE for %s', async (_label, response) => {
    const api = createApi({ token: 't', fetch: () => Promise.resolve(response) });
    await expect(api.pickFolder(null)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it.each([[{ path: 1 }], [{}], ['x'], [null]])('rejects malformed reply %j', async (body) => {
    const api = createApi({ token: 't', fetch: () => Promise.resolve(json(body)) });
    await expect(api.pickFolder(null)).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });
});

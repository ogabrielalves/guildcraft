import { describe, expect, it, vi } from 'vitest';
import { TOKEN_HEADER } from '../../shared/constants.js';
import type { FsListing } from '../../shared/fs.js';
import { ApiError, createApi, isFsListing } from './api.js';
import type { FetchLike } from './api.js';

const LISTING: FsListing = {
  path: '/home/me',
  parent: '/home',
  entries: [{ name: 'code', path: '/home/me/code' }],
  roots: [
    { name: '~', path: '/home/me' },
    { name: '/', path: '/' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('isFsListing', () => {
  it('accepts listings with or without a path', () => {
    expect(isFsListing(LISTING)).toBe(true);
    expect(isFsListing({ ...LISTING, path: null, parent: null, entries: [] })).toBe(true);
  });

  it.each([
    null,
    'x',
    { ...LISTING, path: 1 },
    { ...LISTING, parent: undefined },
    { ...LISTING, entries: 'x' },
    { ...LISTING, entries: [{ name: 'a' }] },
    { ...LISTING, roots: [null] },
    { ...LISTING, roots: undefined },
  ])('rejects %j', (value) => {
    expect(isFsListing(value)).toBe(false);
  });
});

describe('createApi', () => {
  it('lists folders with the session token', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json(LISTING)));
    const api = createApi({ token: 'secret', fetch });
    await expect(api.listFolders('C:\\Users\\me & co')).resolves.toEqual(LISTING);
    expect(fetch).toHaveBeenCalledWith('/api/fs?path=C%3A%5CUsers%5Cme%20%26%20co', {
      headers: { [TOKEN_HEADER]: 'secret' },
    });
  });

  it('asks for the roots without a path and without a token header', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json(LISTING)));
    await createApi({ token: null, fetch }).listFolders(null);
    expect(fetch).toHaveBeenCalledWith('/api/fs', { headers: {} });
  });

  it('turns server errors into ApiError with the error code', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json({ code: 'INVALID_CWD' }, 400)));
    const error: unknown = await createApi({ token: 't', fetch })
      .listFolders('/nope')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'INVALID_CWD', status: 400, name: 'ApiError' });
  });

  it.each([
    ['an unknown code', json({ code: 'NOPE' }, 500)],
    ['a non-object body', json('oops', 500)],
    ['a body that is not json', new Response('<html>', { status: 502 })],
  ])('falls back to INVALID_MESSAGE for %s', async (_label, response) => {
    const api = createApi({ token: 't', fetch: () => Promise.resolve(response) });
    await expect(api.listFolders('/x')).rejects.toMatchObject({ code: 'INVALID_MESSAGE' });
  });

  it('rejects malformed listings', async () => {
    const api = createApi({ token: 't', fetch: () => Promise.resolve(json({ path: 1 })) });
    await expect(api.listFolders('/x')).rejects.toMatchObject({
      code: 'INVALID_MESSAGE',
      status: 200,
    });
  });

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(LISTING));
    await createApi({ token: null }).listFolders(null);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

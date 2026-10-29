import { describe, expect, it } from 'vitest';
import {
  AssetError,
  color,
  count,
  fetchJson,
  fields,
  imagePath,
  list,
  optional,
  point,
  positive,
  rect,
  size,
  text,
} from './parse.js';

function failsAt(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof AssetError) return error.path;
    throw error;
  }
}

describe('parse helpers', () => {
  it('reads objects and lists', () => {
    expect(fields({ a: 1 }, '$')).toEqual({ a: 1 });
    expect(failsAt(() => fields([], '$.x'))).toBe('$.x');
    expect(failsAt(() => fields(null, '$.y'))).toBe('$.y');
    expect(list([1], '$')).toEqual([1]);
    expect(failsAt(() => list({}, '$.l'))).toBe('$.l');
  });

  it('reads numbers', () => {
    expect(positive(2, '$')).toBe(2);
    expect(failsAt(() => positive(0, '$.p'))).toBe('$.p');
    expect(count(0, '$')).toBe(0);
    expect(failsAt(() => count(1, '$.c', 2))).toBe('$.c');
    expect(failsAt(() => count(1.5, '$.c'))).toBe('$.c');
    expect(failsAt(() => count(Number.POSITIVE_INFINITY, '$.c'))).toBe('$.c');
  });

  it('reads text and colours', () => {
    expect(text('a', '$')).toBe('a');
    expect(failsAt(() => text('', '$.t'))).toBe('$.t');
    expect(color('#abc', '$')).toBe('#abc');
    expect(color('#A0B1C2', '$')).toBe('#A0B1C2');
    expect(color('#a0b1c2ff', '$')).toBe('#a0b1c2ff');
    expect(failsAt(() => color('red', '$.c'))).toBe('$.c');
  });

  it.each([
    ['stations/anvil.png', true],
    ['brom.png', true],
    ['tiles/interior-props.png', true],
    ['../escape.png', false],
    ['./brom.png', false],
    ['/abs.png', false],
    ['a/../../b.png', false],
    ['brom.svg', false],
    ['spaces here.png', false],
    [12, false],
  ])('accepts %j as an image path: %s', (value, ok) => {
    const failure = failsAt(() => imagePath(value, '$.image'));
    expect(failure === undefined).toBe(ok);
  });

  it('reads geometry', () => {
    expect(point({ x: 1, y: 2 }, '$')).toEqual({ x: 1, y: 2 });
    expect(size({ width: 3, height: 4 }, '$')).toEqual({ width: 3, height: 4 });
    expect(rect({ x: 1, y: 2, width: 3, height: 4 }, '$')).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(failsAt(() => rect({ x: 1, y: 2, width: 3 }, '$.r'))).toBe('$.r.height');
  });

  it('applies fallbacks only for missing values', () => {
    expect(optional(undefined, positive, '$', 7)).toBe(7);
    expect(optional(3, positive, '$', 7)).toBe(3);
    expect(failsAt(() => optional(null, positive, '$.o', 7))).toBe('$.o');
  });

  it('fetches json or fails on http errors', async () => {
    await expect(fetchJson('/ok', () => Promise.resolve(Response.json({ a: 1 })))).resolves.toEqual(
      { a: 1 },
    );
    const missing = fetchJson('/missing', () => Promise.resolve(new Response('', { status: 404 })));
    await expect(missing).rejects.toMatchObject({ path: '/missing' });
  });
});

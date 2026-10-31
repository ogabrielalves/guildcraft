import { describe, expect, it } from 'vitest';
import { formatCount, totalUsage } from './usage.js';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_500, '1.5k'],
    [25_400, '25k'],
    [3_200_000, '3.2M'],
  ])('formats %i as %s', (value, text) => {
    expect(formatCount(value)).toBe(text);
  });
});

describe('totalUsage', () => {
  it('sums every field and is zero for no agents', () => {
    expect(totalUsage([])).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(
      totalUsage([
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
        { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
      ]),
    ).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
  });
});

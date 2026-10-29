import { describe, expect, it } from 'vitest';
import { DEFAULT_STATION, LIGHTS, stationOf } from './stations.js';

describe('stationOf', () => {
  it.each([
    ['mortis', 'magic', LIGHTS.violet],
    ['corvin', 'dust', LIGHTS.yellow],
    ['lyra', 'smoke', LIGHTS.yellow],
    ['aldwin', 'bubbles', LIGHTS.violet],
    ['brom', 'sparks', LIGHTS.yellow],
    ['seren', 'embers', LIGHTS.orange],
    ['oren', 'bubbles', LIGHTS.violet],
    ['faelan', 'sawdust', LIGHTS.yellow],
    ['amara', 'paper', LIGHTS.yellow],
  ])('gives %s %s with its light', (skin, effect, light) => {
    expect(stationOf(skin)).toEqual({ effect, light });
  });

  it('falls back for unknown characters', () => {
    expect(stationOf('nobody')).toBe(DEFAULT_STATION);
    expect(stationOf('toString')).toBe(DEFAULT_STATION);
  });
});

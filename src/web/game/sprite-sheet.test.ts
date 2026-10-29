import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LPC_MANIFEST,
  SpriteLibrary,
  characterUrl,
  directionTo,
  frameAt,
  loadImage,
} from './sprite-sheet.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frameAt', () => {
  it('picks the row of the facing direction', () => {
    expect(frameAt(LPC_MANIFEST, 'idle', 'north', 0)).toEqual({
      sx: 0,
      sy: 22 * 32,
      width: 32,
      height: 32,
    });
    expect(frameAt(LPC_MANIFEST, 'idle', 'east', 0).sy).toBe(25 * 32);
  });

  it('advances frames with time and loops', () => {
    expect(frameAt(LPC_MANIFEST, 'walk', 'south', 0).sx).toBe(32);
    expect(frameAt(LPC_MANIFEST, 'walk', 'south', 0.25).sx).toBe(3 * 32);
    expect(frameAt(LPC_MANIFEST, 'walk', 'south', 0.8).sx).toBe(32);
  });

  it('holds still poses and clamps negative time', () => {
    expect(frameAt(LPC_MANIFEST, 'sit', 'west', 9).sx).toBe(32);
    expect(frameAt(LPC_MANIFEST, 'cheer', 'south', -3).sx).toBe(64);
  });

  it('ignores the direction on single-row animations', () => {
    const manifest = {
      ...LPC_MANIFEST,
      animations: {
        ...LPC_MANIFEST.animations,
        sit: { row: 20, start: 5, frames: 1, fps: 1, directional: false },
      },
    };
    expect(frameAt(manifest, 'sit', 'east', 0)).toMatchObject({ sx: 160, sy: 640 });
  });
});

describe('directionTo', () => {
  it.each([
    [1, 0, 'east'],
    [-1, 0.5, 'west'],
    [0.2, 1, 'south'],
    [0, -1, 'north'],
    [0, 0, 'west'],
  ] as const)('maps (%d, %d) to %s', (dx, dy, expected) => {
    expect(directionTo(dx, dy, 'west')).toBe(expected);
  });
});

describe('characterUrl', () => {
  it('points to the lpc sheet', () => {
    expect(characterUrl('brom')).toBe('/assets/characters/lpc/brom.png');
    expect(characterUrl('a b')).toBe('/assets/characters/lpc/a%20b.png');
  });
});

describe('SpriteLibrary', () => {
  it('loads each skin once and caches the sheet', async () => {
    const image = {} as CanvasImageSource;
    const load = vi.fn(() => Promise.resolve(image));
    const library = new SpriteLibrary(load);
    expect(library.get('brom')).toBeNull();
    expect(library.get('brom')).toBeNull();
    await Promise.resolve();
    expect(library.get('brom')).toEqual({ image, manifest: LPC_MANIFEST });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('/assets/characters/lpc/brom.png');
  });

  it('keeps a missing skin empty without retrying', async () => {
    const load = vi.fn(() => Promise.reject(new Error('404')));
    const library = new SpriteLibrary(load);
    library.get('mortis');
    await Promise.resolve();
    await Promise.resolve();
    expect(library.get('mortis')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('loadImage', () => {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      queueMicrotask(() => {
        if (url.endsWith('ok.png')) this.onload?.();
        else this.onerror?.();
      });
    }
  }

  it('resolves with the image or rejects on error', async () => {
    vi.stubGlobal('Image', FakeImage);
    await expect(loadImage('/ok.png')).resolves.toBeInstanceOf(FakeImage);
    await expect(loadImage('/bad.png')).rejects.toThrow('/bad.png');
  });
});

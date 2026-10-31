import { describe, expect, it } from 'vitest';
import { recordingPaint } from '../game/draw/recording-paint.js';
import { SIDE_CHARACTER, fakeAssets } from '../game/fake-assets.js';
import { PORTRAIT, characterName, drawPortrait } from './portrait.js';

const named = { ...SIDE_CHARACTER, name: { en: 'Mortis', 'pt-BR': 'Mórtis' } };

describe('characterName', () => {
  it('reads the locale, then English, then the skin id', () => {
    const assets = fakeAssets({ mortis: named, plain: { ...SIDE_CHARACTER, name: {} } });
    expect(characterName(assets, 'mortis', 'pt-BR')).toBe('Mórtis');
    expect(characterName(assets, 'mortis', 'fr')).toBe('Mortis');
    expect(characterName(assets, 'plain', 'en')).toBe('Plain');
    expect(characterName(assets, 'lyra', 'en')).toBe('Lyra');
  });
});

describe('drawPortrait', () => {
  it('draws the idle frame standing on the portrait floor', () => {
    const ctx = recordingPaint();
    drawPortrait(ctx, fakeAssets({ mortis: SIDE_CHARACTER }), 'mortis', 0.2);
    const size = PORTRAIT.width * PORTRAIT.zoom;
    expect(ctx.named('clearRect')[0]?.args).toEqual([0, 0, size, size]);
    const [image, sx, sy, width, height, x, y] = ctx.named('drawImage')[0]?.args ?? [];
    expect(image).toEqual({ url: '/assets/characters/mortis/idle.png' });
    expect([sx, sy, width, height]).toEqual([32, 0, 32, 32]);
    expect([x, y]).toEqual([size / 2 - 32, PORTRAIT.floor * PORTRAIT.zoom - 62]);
  });

  it('scales the frame down when drawn at zoom 1', () => {
    const ctx = recordingPaint();
    drawPortrait(ctx, fakeAssets({ mortis: SIDE_CHARACTER }), 'mortis', 0.2, 1);
    const [, , , , , x, y, width, height] = ctx.named('drawImage')[0]?.args ?? [];
    expect([x, y, width, height]).toEqual([PORTRAIT.width / 2 - 16, PORTRAIT.floor - 31, 32, 32]);
  });

  it('only clears while the character or its sheet is loading', () => {
    const missing = recordingPaint();
    drawPortrait(missing, fakeAssets(), 'mortis', 0);
    const loading = recordingPaint();
    drawPortrait(loading, fakeAssets({ mortis: SIDE_CHARACTER }, {}, false), 'mortis', 0);
    for (const ctx of [missing, loading]) {
      expect(ctx.named('clearRect')).toHaveLength(1);
      expect(ctx.named('drawImage')).toHaveLength(0);
    }
  });
});

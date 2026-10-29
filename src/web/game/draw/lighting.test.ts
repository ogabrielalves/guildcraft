// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Light, LightLayer } from './lighting.js';
import { DARKNESS, GLOW_ALPHA, Lighting, createLayer, lightRadius } from './lighting.js';
import { recordingPaint } from './recording-paint.js';

const lights: Light[] = [
  { at: { x: 10, y: 20 }, radius: 30, color: '#ff0000' },
  { at: { x: 50, y: 60 }, radius: 10, color: '#00ff00', flicker: 0.1 },
];

function layer(): LightLayer & { ctx: ReturnType<typeof recordingPaint> } {
  return { canvas: { width: 100, height: 80 } as HTMLCanvasElement, ctx: recordingPaint() };
}

describe('lightRadius', () => {
  it('keeps steady lights fixed and makes flickering ones wobble', () => {
    expect(lightRadius({ at: { x: 0, y: 0 }, radius: 30, color: '' }, 3)).toBe(30);
    const flicker = { at: { x: 0, y: 0 }, radius: 10, color: '', flicker: 0.1 };
    const radii = [0, 0.1, 0.2, 0.3].map((t) => lightRadius(flicker, t));
    expect(new Set(radii).size).toBeGreaterThan(1);
    for (const radius of radii) {
      expect(radius).toBeGreaterThanOrEqual(9);
      expect(radius).toBeLessThanOrEqual(11);
    }
  });
});

describe('Lighting', () => {
  it('cuts light holes in a dark mask and adds coloured glow', () => {
    const target = layer();
    const factory = vi.fn(() => target);
    const lighting = new Lighting(100, 80, factory);
    const ctx = recordingPaint();
    lighting.draw(ctx, lights, 0);
    lighting.draw(ctx, lights, 0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(100, 80);
    const mask = target.ctx;
    expect(mask.named('clearRect')[0]?.args).toEqual([0, 0, 100, 80]);
    expect(mask.named('fillRect')[0]).toMatchObject({
      fillStyle: DARKNESS,
      composite: 'source-over',
    });
    expect(mask.named('fill').every((c) => c.composite === 'destination-out')).toBe(true);
    expect(mask.named('fill')).toHaveLength(4);
    expect(mask.globalCompositeOperation).toBe('source-over');
    expect(ctx.named('drawImage')[0]?.args).toEqual([target.canvas, 0, 0]);
    const glow = ctx.named('fill');
    expect(glow).toHaveLength(4);
    expect(glow.every((c) => c.composite === 'lighter' && c.globalAlpha === GLOW_ALPHA)).toBe(true);
    expect(ctx.globalAlpha).toBe(1);
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('does nothing without a layer', () => {
    const factory = vi.fn(() => null);
    const lighting = new Lighting(100, 80, factory);
    const ctx = recordingPaint();
    lighting.draw(ctx, lights, 0);
    lighting.draw(ctx, lights, 0);
    expect(ctx.calls).toHaveLength(0);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});

describe('createLayer', () => {
  it('makes a canvas of the world size', () => {
    const context = {} as CanvasRenderingContext2D;
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValueOnce(context)
      .mockReturnValueOnce(null);
    const made = createLayer(120, 60);
    expect(made?.canvas).toMatchObject({ width: 120, height: 60 });
    expect(made?.ctx).toBe(context);
    expect(createLayer(1, 1)).toBeNull();
    getContext.mockRestore();
  });
});

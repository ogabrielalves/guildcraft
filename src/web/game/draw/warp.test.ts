import { describe, expect, it } from 'vitest';
import { recordingPaint } from './recording-paint.js';
import { bodyAlpha, bodyWhite, drawWarp, warpAmount } from './warp.js';

describe('warp effect', () => {
  it('fades the body out and back in', () => {
    expect(bodyAlpha('out', 0)).toBe(1);
    expect(bodyAlpha('out', 1)).toBe(0);
    expect(bodyAlpha('in', 0)).toBe(0);
    expect(bodyAlpha('in', 1)).toBe(1);
  });

  it('turns white before fading out and clears up after appearing', () => {
    expect(bodyWhite('out', 0)).toBe(0);
    expect(bodyWhite('out', 0.55)).toBe(1);
    expect(bodyAlpha('out', 0.55)).toBe(1);
    expect(bodyWhite('in', 0.55)).toBe(1);
    expect(bodyAlpha('in', 0.55)).toBe(1);
    expect(bodyWhite('in', 1)).toBe(0);
  });

  it('peaks the effect in the middle of each phase', () => {
    expect(warpAmount('out', 0.25)).toBe(0.25);
    expect(warpAmount('in', 0.25)).toBe(0.75);
  });

  it('draws rings and a light beam, then restores the alpha', () => {
    const paint = recordingPaint();
    drawWarp(paint, { x: 50, y: 80 }, 'out', 0.5, 1);
    expect(paint.named('ellipse').length > 0).toBe(true);
    expect(paint.named('fillRect').length).toBeGreaterThanOrEqual(3);
    expect(paint.globalAlpha).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { BUBBLE_COLORS, bubbleFor, drawBubble } from './bubble.js';
import { NAMEPLATE_COLORS, badgeText, drawNameplate } from './nameplate.js';
import { recordingPaint } from './recording-paint.js';
import { RING_COLORS, drawRing, drawShadow, ringAlpha } from './rings.js';

const still = { waiting: false, selected: false, focused: false, hovered: false };

describe('rings', () => {
  it.each([
    [still, 0],
    [{ ...still, hovered: true }, 0.5],
    [{ ...still, selected: true, hovered: true }, 1],
    [{ ...still, waiting: true }, 0.6],
  ])('fades %j to %d', (state, alpha) => {
    expect(ringAlpha(state, 0)).toBeCloseTo(alpha);
  });

  it('pulses while waiting', () => {
    expect(ringAlpha({ ...still, waiting: true }, Math.PI / 10)).toBeCloseTo(1);
  });

  it('skips invisible rings', () => {
    const ctx = recordingPaint();
    drawRing(ctx, { x: 1, y: 2 }, still, 0);
    expect(ctx.calls).toHaveLength(0);
  });

  it('strokes the selection ring, thicker when focused', () => {
    const ctx = recordingPaint();
    drawRing(ctx, { x: 1, y: 2 }, { ...still, selected: true, focused: true }, 0);
    expect(ctx.strokeStyle).toBe(RING_COLORS.selected);
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.named('ellipse')[0]?.args.slice(0, 2)).toEqual([1, 2]);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('uses the waiting colour over selection', () => {
    const ctx = recordingPaint();
    drawRing(ctx, { x: 0, y: 0 }, { ...still, waiting: true, selected: true }, 0);
    expect(ctx.strokeStyle).toBe(RING_COLORS.waiting);
    expect(ctx.lineWidth).toBe(1);
  });

  it('draws a soft shadow under the feet', () => {
    const ctx = recordingPaint();
    drawShadow(ctx, { x: 5, y: 6 });
    expect(ctx.named('fill')[0]).toMatchObject({ fillStyle: RING_COLORS.shadow, globalAlpha: 0.3 });
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe('nameplate', () => {
  it.each([
    [0, null],
    [-1, null],
    [1, '1'],
    [99, '99'],
    [150, '99+'],
  ])('badges %d as %s', (queued, text) => {
    expect(badgeText(queued)).toBe(text);
  });

  it('draws the name on a plate', () => {
    const ctx = recordingPaint();
    drawNameplate(ctx, 'Brom', 0, 50, 40);
    expect(ctx.named('fillRect')[0]?.args).toEqual([40, 31, 20, 9]);
    expect(ctx.named('fillText')).toEqual([
      expect.objectContaining({ args: ['Brom', 50, 39], fillStyle: NAMEPLATE_COLORS.name }),
    ]);
  });

  it('adds a queue badge at the plate corner', () => {
    const ctx = recordingPaint();
    drawNameplate(ctx, 'Brom', 12, 50, 40);
    expect(ctx.named('arc')[0]?.args.slice(0, 3)).toEqual([64, 31, 5]);
    expect(ctx.named('fill')[0]?.fillStyle).toBe(NAMEPLATE_COLORS.badge);
    expect(ctx.named('fillText')[1]?.args[0]).toBe('12');
    drawNameplate(ctx, 'Brom', 2, 50, 40);
    expect(ctx.named('arc')[1]?.args[2]).toBe(4);
  });
});

describe('bubble', () => {
  it.each([
    ['think', false, '💭'],
    ['read', false, '📜'],
    ['wait', false, '❗'],
    ['sleep', false, '💤'],
    ['off', false, '💤'],
    ['idle', false, null],
    ['write', false, null],
    ['write', true, '✉️'],
  ] as const)('shows %s (visiting %s) as %s', (activity, visiting, text) => {
    expect(bubbleFor(activity, visiting)).toBe(text);
  });

  it('draws a framed bubble with a tail and the icon', () => {
    const ctx = recordingPaint();
    drawBubble(ctx, '💭', 30, 20, 0);
    const [border, body] = ctx.named('fillRect');
    expect(border).toMatchObject({ fillStyle: BUBBLE_COLORS.border, args: [23, 5, 15, 13] });
    expect(body).toMatchObject({ fillStyle: BUBBLE_COLORS.fill, args: [24, 6, 13, 11] });
    expect(ctx.named('lineTo')).toHaveLength(2);
    expect(ctx.named('fillText')[0]?.args).toEqual(['💭', 30, 12]);
  });

  it('bobs with time', () => {
    const ctx = recordingPaint();
    drawBubble(ctx, '💤', 30, 20, Math.PI / 6);
    expect(ctx.named('fillRect')[1]?.args[1]).toBe(7);
  });
});

import type { Point } from '../map.js';
import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const RING_COLORS = { selected: '#f0a63a', waiting: '#f2c94c', shadow: '#000000' };

export interface RingState {
  waiting: boolean;
  selected: boolean;
  focused: boolean;
  hovered: boolean;
}

export function ringAlpha(state: RingState, time: number): number {
  if (state.waiting) return 0.6 + 0.4 * Math.sin(time * 5);
  if (state.selected) return 1;
  return state.hovered ? 0.5 : 0;
}

export function drawShadow(ctx: Paint, { x, y }: Point): void {
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = RING_COLORS.shadow;
  ctx.beginPath();
  ctx.ellipse(x, y, 6, 2.5, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawRing(ctx: Paint, { x, y }: Point, state: RingState, time: number): void {
  const alpha = ringAlpha(state, time);
  if (alpha <= 0) return;
  ctx.strokeStyle = state.waiting ? RING_COLORS.waiting : RING_COLORS.selected;
  ctx.lineWidth = state.focused ? 2 : 1;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(x, y, 10, 4, 0, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

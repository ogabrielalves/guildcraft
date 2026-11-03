import type { Point } from '../map.js';
import type { WarpPhase } from '../villager.js';
import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const WARP_COLORS = {
  beam: '#e6ffd0',
  flame: '#5dff6e',
  ring: '#3ddc5a',
  glow: '#0f9f3c',
  tint: '#9dff9d',
};
export const WARP_HEIGHT = 40;
export const WARP_RATE = 70;

const FLASH = 0.55;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function warpAmount(phase: WarpPhase, progress: number): number {
  return phase === 'out' ? progress : 1 - progress;
}

export function bodyWhite(phase: WarpPhase, progress: number): number {
  return phase === 'out' ? clamp(progress / FLASH) : clamp((1 - progress) / (1 - FLASH));
}

export function bodyAlpha(phase: WarpPhase, progress: number): number {
  if (phase === 'out') return 1 - clamp((progress - FLASH) / (1 - FLASH));
  return clamp(progress / FLASH);
}

const TONGUES = 5;

function drawTongues(
  ctx: Paint,
  { x, y }: Point,
  fire: { width: number; height: number; time: number },
): void {
  const { width, height, time } = fire;
  const step = width / TONGUES;
  const layers = [
    { color: WARP_COLORS.glow, shrink: 0, alpha: 0.55 },
    { color: WARP_COLORS.flame, shrink: 0.25, alpha: 0.8 },
    { color: WARP_COLORS.beam, shrink: 0.55, alpha: 0.9 },
  ];
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    ctx.globalAlpha = layer.alpha;
    for (let index = 0; index < TONGUES; index += 1) {
      const flicker = 0.6 + 0.4 * Math.sin(time * 18 + index * 1.7);
      const lean = Math.round(Math.sin(time * 9 + index) * 1.5);
      const tall = Math.round(height * flicker * (1 - layer.shrink * 0.5));
      const wide = Math.max(1, Math.round(step * (1 - layer.shrink)));
      const left = Math.round(x - width / 2 + index * step + (step - wide) / 2) + lean;
      ctx.fillRect(left, y - tall, wide, tall);
    }
  }
}

export function drawWarp(
  ctx: Paint,
  at: Point,
  phase: WarpPhase,
  progress: number,
  time: number,
): void {
  const { x, y } = at;
  const amount = warpAmount(phase, progress);
  const pulse = Math.sin(amount * Math.PI);
  const radius = 7 + 7 * pulse;
  ctx.strokeStyle = WARP_COLORS.ring;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4 + 0.6 * pulse;
  ctx.beginPath();
  ctx.ellipse(x, y, radius, radius / 2.5, 0, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 0.55, radius * 0.22, 0, 0, TAU);
  ctx.stroke();
  const width = Math.max(5, Math.round(16 * pulse));
  drawTongues(ctx, at, { width, height: WARP_HEIGHT * (0.5 + 0.5 * pulse), time });
  ctx.globalAlpha = 1;
}

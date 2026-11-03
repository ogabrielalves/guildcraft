import type { Point } from '../map.js';
import type { WarpPhase } from '../villager.js';
import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const WARP_COLORS = { beam: '#fff0fa', ring: '#ff8ad8', glow: '#ff5fc0' };
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

export function drawWarp(ctx: Paint, { x, y }: Point, phase: WarpPhase, progress: number): void {
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
  const width = Math.max(2, Math.round(12 * pulse));
  ctx.fillStyle = WARP_COLORS.glow;
  ctx.globalAlpha = 0.3 * pulse;
  ctx.fillRect(Math.round(x - width / 2 - 2), y - WARP_HEIGHT, width + 4, WARP_HEIGHT);
  ctx.fillStyle = WARP_COLORS.beam;
  ctx.globalAlpha = 0.55 * pulse;
  ctx.fillRect(Math.round(x - width / 2), y - WARP_HEIGHT, width, WARP_HEIGHT);
  ctx.globalAlpha = 1;
}

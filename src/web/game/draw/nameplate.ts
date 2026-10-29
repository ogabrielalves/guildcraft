import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const NAMEPLATE_COLORS = { plate: '#17110d', name: '#f1e4cf', badge: '#e2604f' };
export const NAME_FONT = '600 7px system-ui, sans-serif';
export const BADGE_FONT = '700 6px system-ui, sans-serif';
export const PLATE_HEIGHT = 9;
export const MAX_BADGE = 99;

export function badgeText(queued: number): string | null {
  if (queued <= 0) return null;
  return queued > MAX_BADGE ? `${String(MAX_BADGE)}+` : String(queued);
}

export function drawNameplate(
  ctx: Paint,
  name: string,
  queued: number,
  centerX: number,
  bottom: number,
): void {
  ctx.font = NAME_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const width = Math.ceil(ctx.measureText(name).width) + 4;
  const left = Math.round(centerX - width / 2);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = NAMEPLATE_COLORS.plate;
  ctx.fillRect(left, bottom - PLATE_HEIGHT, width, PLATE_HEIGHT);
  ctx.globalAlpha = 1;
  ctx.fillStyle = NAMEPLATE_COLORS.name;
  ctx.fillText(name, Math.round(centerX), bottom - 1);
  const badge = badgeText(queued);
  if (badge === null) return;
  const radius = badge.length > 1 ? 5 : 4;
  const cx = left + width + radius - 1;
  const cy = bottom - PLATE_HEIGHT;
  ctx.fillStyle = NAMEPLATE_COLORS.badge;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
  ctx.font = BADGE_FONT;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = NAMEPLATE_COLORS.name;
  ctx.fillText(badge, cx, cy + 0.5);
}

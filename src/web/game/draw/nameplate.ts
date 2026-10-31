import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const NAMEPLATE_COLORS = { plate: '#17110d', name: '#f1e4cf', badge: '#e2604f' };
export const NAME_FONT = '600 7px system-ui, sans-serif';
export const BADGE_FONT = '700 6px system-ui, sans-serif';
export const PLATE_HEIGHT = 9;
export const MAX_BADGE = 99;
export const TAG_COLORS = {
  chain: '#2b2622',
  frame: '#2a170b',
  wood: '#7b5330',
  light: '#a07245',
  shade: '#573719',
  rivet: '#e3b24c',
  text: '#f7e6b8',
  shadow: '#1a0e06',
};
export const TAG_FONT = '700 7px system-ui, sans-serif';
export const TAG_HEIGHT = 12;
export const TAG_CHAIN = 4;
export const MAX_TAG = 16;

export function tagText(folder: string): string {
  return folder.length > MAX_TAG ? `${folder.slice(0, MAX_TAG - 1)}…` : folder;
}

export function drawFolderTag(ctx: Paint, folder: string, centerX: number, top: number): void {
  const text = tagText(folder);
  ctx.font = TAG_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = Math.ceil(ctx.measureText(text).width) + 14;
  const left = Math.round(centerX - width / 2);
  const right = left + width;
  const plank = top + TAG_CHAIN;
  ctx.fillStyle = TAG_COLORS.chain;
  ctx.fillRect(left + 3, top, 1, TAG_CHAIN);
  ctx.fillRect(right - 4, top, 1, TAG_CHAIN);
  ctx.fillStyle = TAG_COLORS.frame;
  ctx.fillRect(left - 1, plank - 1, width + 2, TAG_HEIGHT + 2);
  ctx.fillStyle = TAG_COLORS.wood;
  ctx.fillRect(left, plank, width, TAG_HEIGHT);
  ctx.fillStyle = TAG_COLORS.light;
  ctx.fillRect(left, plank, width, 1);
  ctx.fillStyle = TAG_COLORS.shade;
  ctx.fillRect(left, plank + TAG_HEIGHT - 1, width, 1);
  ctx.fillStyle = TAG_COLORS.rivet;
  ctx.fillRect(left + 2, plank + TAG_HEIGHT / 2 - 1, 2, 2);
  ctx.fillRect(right - 4, plank + TAG_HEIGHT / 2 - 1, 2, 2);
  const x = Math.round(centerX);
  const y = plank + TAG_HEIGHT / 2 + 0.5;
  ctx.fillStyle = TAG_COLORS.shadow;
  ctx.fillText(text, x, y + 1);
  ctx.fillStyle = TAG_COLORS.text;
  ctx.fillText(text, x, y);
}

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

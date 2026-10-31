import type { Assets } from '../game/assets.js';
import type { Paint } from '../game/draw/paint.js';
import { frameAt } from '../game/sprite-sheet.js';

export const PORTRAIT = { width: 40, height: 40, floor: 38, zoom: 2 };

export function skinLabel(skin: string): string {
  return skin.charAt(0).toUpperCase() + skin.slice(1);
}

export function characterName(assets: Assets, skin: string, locale: string): string {
  const names = assets.character(skin)?.manifest.name;
  return names?.[locale] ?? names?.en ?? skinLabel(skin);
}

export function drawPortrait(
  ctx: Paint,
  assets: Assets,
  skin: string,
  time: number,
  zoom = PORTRAIT.zoom,
): void {
  ctx.clearRect(0, 0, PORTRAIT.width * zoom, PORTRAIT.height * zoom);
  const character = assets.character(skin);
  if (!character) return;
  const frame = frameAt(character.manifest, 'idle', 'south', 'east', time);
  const image = assets.image(character.base + frame.image);
  if (!image) return;
  ctx.drawImage(
    image,
    frame.sx,
    frame.sy,
    frame.width,
    frame.height,
    Math.round((PORTRAIT.width / 2) * zoom - frame.anchor.x * frame.scale * zoom),
    PORTRAIT.floor * zoom - frame.anchor.y * frame.scale * zoom,
    frame.width * frame.scale * zoom,
    frame.height * frame.scale * zoom,
  );
}

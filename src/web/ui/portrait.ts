import type { Assets } from '../game/assets.js';
import type { Paint } from '../game/draw/paint.js';
import { frameAt } from '../game/sprite-sheet.js';
import { skinLabel } from './panel.js';

export const PORTRAIT = { width: 40, height: 40, floor: 38 };

export function characterName(assets: Assets, skin: string, locale: string): string {
  const names = assets.character(skin)?.manifest.name;
  return names?.[locale] ?? names?.en ?? skinLabel(skin);
}

export function drawPortrait(ctx: Paint, assets: Assets, skin: string, time: number): void {
  ctx.clearRect(0, 0, PORTRAIT.width, PORTRAIT.height);
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
    Math.round(PORTRAIT.width / 2 - frame.anchor.x),
    PORTRAIT.floor - frame.anchor.y,
    frame.width,
    frame.height,
  );
}

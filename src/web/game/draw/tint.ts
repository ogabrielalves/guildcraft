import type { Rect } from '../map.js';

let scratch: HTMLCanvasElement | null = null;

export function whitened(
  image: CanvasImageSource,
  source: Rect,
  amount: number,
  color = '#ffffff',
): CanvasImageSource | null {
  if (typeof document === 'undefined') return null;
  scratch ??= document.createElement('canvas');
  const ctx = scratch.getContext('2d');
  if (ctx === null) return null;
  scratch.width = source.width;
  scratch.height = source.height;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height,
  );
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = Math.min(1, Math.max(0, amount));
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, source.width, source.height);
  return scratch;
}

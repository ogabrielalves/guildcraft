import type { Point } from '../map.js';
import type { Paint } from './paint.js';
import { TAU } from './paint.js';

export const DARKNESS = 'rgba(12, 8, 20, 0.5)';
export const GLOW_ALPHA = 0.18;

export interface Light {
  at: Point;
  radius: number;
  color: string;
  flicker?: number;
}

export interface LightLayer {
  canvas: CanvasImageSource & { width: number; height: number };
  ctx: Paint;
}

export type LayerFactory = (width: number, height: number) => LightLayer | null;

export function createLayer(width: number, height: number): LightLayer | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

export function lightRadius(light: Light, time: number): number {
  if (light.flicker === undefined) return light.radius;
  const wobble = Math.sin(time * 11) * 0.6 + Math.sin(time * 17 + 1.3) * 0.4;
  return light.radius * (1 + light.flicker * wobble);
}

export class Lighting {
  private layer: LightLayer | null | undefined;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly factory: LayerFactory = createLayer,
  ) {}

  draw(ctx: Paint, lights: readonly Light[], time: number): void {
    if (this.layer === undefined) this.layer = this.factory(this.width, this.height);
    const layer = this.layer;
    if (layer === null) return;
    const mask = layer.ctx;
    mask.globalCompositeOperation = 'source-over';
    mask.clearRect(0, 0, this.width, this.height);
    mask.fillStyle = DARKNESS;
    mask.fillRect(0, 0, this.width, this.height);
    mask.globalCompositeOperation = 'destination-out';
    for (const light of lights) {
      const { x, y } = light.at;
      const radius = lightRadius(light, time);
      const gradient = mask.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mask.fillStyle = gradient;
      mask.beginPath();
      mask.arc(x, y, radius, 0, TAU);
      mask.fill();
    }
    mask.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const light of lights) {
      const { x, y } = light.at;
      const radius = lightRadius(light, time);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, light.color);
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalAlpha = GLOW_ALPHA;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

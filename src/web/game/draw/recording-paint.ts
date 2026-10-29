import type { Paint } from './paint.js';

export interface PaintCall {
  name: string;
  args: unknown[];
  fillStyle: unknown;
  globalAlpha: number;
  composite: string;
}

export type RecordingPaint = Paint & { calls: PaintCall[]; named(name: string): PaintCall[] };

const METHODS = [
  'fillRect',
  'strokeRect',
  'clearRect',
  'beginPath',
  'moveTo',
  'lineTo',
  'closePath',
  'ellipse',
  'arc',
  'fill',
  'stroke',
  'fillText',
  'drawImage',
  'save',
  'restore',
] as const;

export function recordingPaint(): RecordingPaint {
  const calls: PaintCall[] = [];
  const ctx = {
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    calls,
    named: (name: string) => calls.filter((call) => call.name === name),
    measureText: (text: string) => ({ width: text.length * 4 }),
    createRadialGradient: (...args: unknown[]) => {
      const stops: [number, string][] = [];
      return {
        args,
        stops,
        addColorStop: (offset: number, color: string) => stops.push([offset, color]),
      };
    },
  };
  for (const name of METHODS) {
    Object.assign(ctx, {
      [name]: (...args: unknown[]) => {
        calls.push({
          name,
          args,
          fillStyle: ctx.fillStyle,
          globalAlpha: ctx.globalAlpha,
          composite: ctx.globalCompositeOperation,
        });
      },
    });
  }
  return ctx as unknown as RecordingPaint;
}

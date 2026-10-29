import type { Activity } from '../activity.js';
import type { Paint } from './paint.js';

export const BUBBLE_COLORS = { fill: '#f1e4cf', border: '#17110d' };
export const BUBBLE_FONT = '8px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export const BUBBLE_SIZE = { width: 13, height: 11 };

const ACTIVITY_BUBBLES: Partial<Record<Activity, string>> = {
  think: '💭',
  read: '📜',
  wait: '❗',
  sleep: '💤',
  off: '💤',
};

export function bubbleFor(activity: Activity, visiting: boolean): string | null {
  if (visiting) return '✉️';
  return ACTIVITY_BUBBLES[activity] ?? null;
}

export function drawBubble(
  ctx: Paint,
  text: string,
  centerX: number,
  bottom: number,
  time: number,
): void {
  const { width, height } = BUBBLE_SIZE;
  const bob = Math.round(Math.sin(time * 3) * 1);
  const left = Math.round(centerX - width / 2);
  const top = bottom - height - 3 + bob;
  ctx.fillStyle = BUBBLE_COLORS.border;
  ctx.fillRect(left - 1, top - 1, width + 2, height + 2);
  ctx.fillStyle = BUBBLE_COLORS.fill;
  ctx.fillRect(left, top, width, height);
  ctx.beginPath();
  ctx.moveTo(centerX - 2, top + height);
  ctx.lineTo(centerX + 2, top + height);
  ctx.lineTo(centerX, top + height + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = BUBBLE_COLORS.border;
  ctx.font = BUBBLE_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, top + height / 2 + 0.5);
}

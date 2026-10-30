import type { Activity, IdlePlan } from '../activity.js';
import type { Paint } from './paint.js';

export const BUBBLE_COLORS = { fill: '#f1e4cf', border: '#17110d' };
export const BUBBLE_FONT = '8px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export const BUBBLE_SIZE = { width: 13, height: 11 };
export const NOTE_FONT = '6px system-ui, "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export const NOTE_LENGTH = 28;
export const NOTE_ICON = '✉️';

const ACTIVITY_BUBBLES: Partial<Record<Activity, string>> = {
  think: '💭',
  read: '📜',
  wait: '❗',
  sleep: '💤',
  off: '💤',
};

const IDLE_BUBBLES: Partial<Record<IdlePlan, string>> = {
  chat: '💬',
  nap: '💤',
};

export function bubbleFor(
  activity: Activity,
  visiting: boolean,
  doing: IdlePlan | null = null,
): string | null {
  if (visiting) return NOTE_ICON;
  return ACTIVITY_BUBBLES[activity] ?? (doing === null ? null : (IDLE_BUBBLES[doing] ?? null));
}

export function shortNote(text: string, max = NOTE_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(new Intl.Segmenter().segment(flat), ({ segment }) => segment);
  if (chars.length <= max) return chars.join('');
  const kept = chars.slice(0, max - 1).join('');
  return `${kept.trimEnd()}…`;
}

export function drawNote(ctx: Paint, note: string, centerX: number, bottom: number, time: number) {
  ctx.font = NOTE_FONT;
  const text = `${NOTE_ICON} ${shortNote(note)}`;
  const width = Math.ceil(ctx.measureText(text).width) + 6;
  drawBubble(ctx, text, centerX, bottom, time, width, NOTE_FONT);
}

export function drawBubble(
  ctx: Paint,
  text: string,
  centerX: number,
  bottom: number,
  time: number,
  width = BUBBLE_SIZE.width,
  font = BUBBLE_FONT,
): void {
  const { height } = BUBBLE_SIZE;
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
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, centerX, top + height / 2 + 0.5);
}

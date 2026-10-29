export const KEY_UP = '\x1b[A';
export const KEY_DOWN = '\x1b[B';
export const KEY_ENTER = '\r';

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const CURSOR_FORWARD = new RegExp(`${ESC}\\[(\\d*)C`, 'g');
const OSC = new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, 'g');
const CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, 'g');
const SHORT_ESCAPE = new RegExp(`${ESC}[0-_]`, 'g');

const QUESTIONS = [
  /do you trust the files in this folder/i,
  /is this a project you created or one you trust/i,
];
const OPTION_LINE = /^[\s│|]*([❯›>])?\s*(?:\d+\.\s+)?((?:yes|no)\b.*?)[\s│|]*$/i;
const YES_OPTION = /^yes\b/i;

interface TrustOption {
  label: string;
  selected: boolean;
}

export function stripAnsi(text: string): string {
  return text
    .replace(CURSOR_FORWARD, (_, count: string) => ' '.repeat(Number(count || '1')))
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(SHORT_ESCAPE, '')
    .replace(/\r\n?/g, '\n');
}

export function detectTrustPrompt(screen: string): boolean {
  return questionLine(stripAnsi(screen).split('\n')) !== -1;
}

export function trustAnswer(screen: string): string | null {
  const lines = stripAnsi(screen).split('\n');
  const start = questionLine(lines);
  if (start === -1) return null;
  const options = parseOptions(lines.slice(start + 1));
  const yes = options.findIndex((option) => YES_OPTION.test(option.label));
  const selected = options.findIndex((option) => option.selected);
  if (yes === -1 || selected === -1) return null;
  const moves = yes - selected;
  return (moves < 0 ? KEY_UP : KEY_DOWN).repeat(Math.abs(moves)) + KEY_ENTER;
}

function questionLine(lines: string[]): number {
  return lines.findLastIndex((line) => QUESTIONS.some((question) => question.test(line)));
}

function parseOptions(lines: string[]): TrustOption[] {
  const options: TrustOption[] = [];
  for (const line of lines) {
    const match = OPTION_LINE.exec(line);
    if (match?.[2]) options.push({ label: match[2], selected: match[1] !== undefined });
    else if (options.length > 0 && line.replace(/[\s│|]/g, '') !== '') break;
  }
  return options;
}

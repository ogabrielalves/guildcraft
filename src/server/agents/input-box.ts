import { sanitizePrompt } from './message-queue.js';
import { stripAnsi } from './trust-prompt.js';

export const MAX_FOOTER_LINES = 3;
export const MATCH_LENGTH = 40;

const RULE = /^\s*[╭╰]?[─━]{8,}[╮╯]?\s*$/;
const PROMPT = /^[❯>] ?/;
const BORDER = /^\s*[│|]|[│|]\s*$/g;
const COLLAPSED_PASTE = /^\[Pasted text #\d+/;

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function inputBoxText(screen: string): string | null {
  const lines = stripAnsi(screen).split('\n');
  const rules = lines.flatMap((line, index) => (RULE.test(line) ? [index] : []));
  const [top, bottom] = rules.slice(-2);
  if (top === undefined || bottom === undefined) return null;
  const footer = lines.slice(bottom + 1).filter((line) => line.trim() !== '');
  if (footer.length > MAX_FOOTER_LINES) return null;
  const body = collapse(
    lines
      .slice(top + 1, bottom)
      .map((line) => line.replace(BORDER, ''))
      .join(' '),
  );
  return PROMPT.test(body) ? body.replace(PROMPT, '') : null;
}

export function holdsPrompt(screen: string, text: string): boolean {
  const box = inputBoxText(screen);
  if (box === null) return false;
  const wanted = collapse(sanitizePrompt(text)).slice(0, MATCH_LENGTH);
  return wanted !== '' && (box.startsWith(wanted) || COLLAPSED_PASTE.test(box));
}

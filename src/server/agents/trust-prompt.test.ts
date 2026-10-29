import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KEY_DOWN,
  KEY_ENTER,
  KEY_UP,
  detectTrustPrompt,
  stripAnsi,
  trustAnswer,
} from './trust-prompt.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const DEFAULT_SCREEN = fixture('trust-default.txt');
const YES_SELECTED_SCREEN = fixture('trust-yes-selected.txt');
const SERIALIZED_SCREEN = fixture('trust-default.serialized.txt');
const LEGACY_SCREEN = fixture('trust-legacy-numbered.synthetic.txt');
const IDLE_SCREEN = fixture('idle-prompt.synthetic.txt');

describe('stripAnsi', () => {
  it('turns cursor-forward moves into spaces', () => {
    expect(stripAnsi('a\x1b[1Cb\x1b[3Cc\x1b[Cd')).toBe('a b   c d');
  });

  it('removes colors, modes and titles', () => {
    expect(
      stripAnsi('\x1b]0;agent\x07\x1b[?2004h\x1b[38;2;1;2;3mhi\x1b[m\x1b]8;;x\x1b\\\x1b7'),
    ).toBe('hi');
  });

  it('normalizes line endings', () => {
    expect(stripAnsi('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('matches the plain screen for a serialized snapshot', () => {
    const lines = (text: string) => text.split('\n').map((line) => line.trimEnd());
    expect(lines(stripAnsi(SERIALIZED_SCREEN)).filter(Boolean)).toEqual(
      lines(DEFAULT_SCREEN).filter(Boolean),
    );
  });
});

describe('detectTrustPrompt', () => {
  it.each([
    ['default selection', DEFAULT_SCREEN],
    ['yes selected', YES_SELECTED_SCREEN],
    ['serialized snapshot', SERIALIZED_SCREEN],
    ['legacy numbered dialog', LEGACY_SCREEN],
  ])('detects the %s screen', (_, screen) => {
    expect(detectTrustPrompt(screen)).toBe(true);
  });

  it('ignores a normal session that mentions trust', () => {
    expect(detectTrustPrompt(IDLE_SCREEN)).toBe(false);
  });

  it('ignores an empty screen', () => {
    expect(detectTrustPrompt('')).toBe(false);
  });
});

describe('trustAnswer', () => {
  it('moves down from the default "No, exit" before confirming', () => {
    expect(trustAnswer(DEFAULT_SCREEN)).toBe(KEY_DOWN + KEY_ENTER);
  });

  it('works on a serialized snapshot', () => {
    expect(trustAnswer(SERIALIZED_SCREEN)).toBe(KEY_DOWN + KEY_ENTER);
  });

  it('only confirms when yes is already selected', () => {
    expect(trustAnswer(YES_SELECTED_SCREEN)).toBe(KEY_ENTER);
  });

  it('confirms the legacy numbered dialog', () => {
    expect(trustAnswer(LEGACY_SCREEN)).toBe(KEY_ENTER);
  });

  it('moves up when the cursor is below yes', () => {
    const screen = LEGACY_SCREEN.replace('❯ 1. Yes', '  1. Yes').replace('  2. No', '❯ 2. No');
    expect(trustAnswer(screen)).toBe(KEY_UP + KEY_ENTER);
  });

  it('reads the latest dialog when scrollback has an older one', () => {
    expect(trustAnswer(`${YES_SELECTED_SCREEN}\n${DEFAULT_SCREEN}`)).toBe(KEY_DOWN + KEY_ENTER);
  });

  it('returns null outside the dialog', () => {
    expect(trustAnswer(IDLE_SCREEN)).toBeNull();
  });

  it('returns null when no option is highlighted', () => {
    expect(trustAnswer(DEFAULT_SCREEN.replace('❯', ' '))).toBeNull();
  });

  it('returns null when there is no yes option', () => {
    const screen = DEFAULT_SCREEN.replace('Yes, I trust this folder', 'Review files first');
    expect(trustAnswer(screen)).toBeNull();
  });

  it('returns null while the options are not drawn yet', () => {
    const question = DEFAULT_SCREEN.split('\n').find((line) => line.includes('Quick safety'));
    expect(trustAnswer(question ?? '')).toBeNull();
  });
});

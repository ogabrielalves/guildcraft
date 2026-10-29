import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { holdsPrompt, inputBoxText } from './input-box.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const PROMPT =
  'Summarize the README of this repository in two short sentences please, focusing on what the project does';
const RULE = '─'.repeat(40);

describe('inputBoxText', () => {
  it('reads the pending input of the current claude screen', () => {
    expect(inputBoxText(fixture('input-pending.serialized.txt'))).toBe(PROMPT);
  });

  it('joins a multi-line input', () => {
    expect(inputBoxText(fixture('input-multiline.serialized.txt'))).toBe(
      `${PROMPT}line one line two line three`,
    );
  });

  it('reads the legacy bordered box', () => {
    expect(inputBoxText(fixture('idle-prompt.synthetic.txt'))).toBe('');
  });

  it('reads an empty input after a submit', () => {
    expect(inputBoxText(fixture('input-empty-after-submit.synthetic.txt'))).toBe('');
  });

  it('finds no input under a permission dialog', () => {
    expect(inputBoxText(fixture('permission-dialog.synthetic.txt'))).toBeNull();
  });

  it.each([
    ['no rules', '❯ hi'],
    ['a single rule', `${RULE}\n❯ hi`],
    ['no prompt marker', `${RULE}\nhi\n${RULE}`],
  ])('returns null with %s', (_, screen) => {
    expect(inputBoxText(screen)).toBeNull();
  });
});

describe.each([
  ['LF', '\n'],
  ['CRLF', '\r\n'],
])('screens with %s line endings', (_, eol) => {
  const withEol = (name: string) => fixture(name).replace(/\r?\n/g, eol);

  it('reads the pending input', () => {
    expect(inputBoxText(withEol('input-pending.serialized.txt'))).toBe(PROMPT);
    expect(holdsPrompt(withEol('input-multiline.serialized.txt'), PROMPT)).toBe(true);
  });

  it('refuses a permission dialog', () => {
    expect(holdsPrompt(withEol('permission-dialog.synthetic.txt'), PROMPT)).toBe(false);
  });
});

describe('holdsPrompt', () => {
  it('matches the pasted text still waiting in the input', () => {
    expect(holdsPrompt(fixture('input-pending.serialized.txt'), PROMPT)).toBe(true);
    expect(holdsPrompt(fixture('input-multiline.serialized.txt'), PROMPT)).toBe(true);
  });

  it('matches a paste that claude collapsed', () => {
    expect(holdsPrompt(`${RULE}\n❯ [Pasted text #1 +12 lines]\n${RULE}`, 'a\nb')).toBe(true);
  });

  it('ignores line breaks and extra spaces in the prompt', () => {
    expect(
      holdsPrompt(`${RULE}\n❯ fix the\n  failing tests\n${RULE}`, 'fix  the\r\nfailing tests'),
    ).toBe(true);
  });

  it.each([
    ['an empty input', 'input-empty-after-submit.synthetic.txt'],
    ['a permission dialog', 'permission-dialog.synthetic.txt'],
  ])('refuses %s', (_, name) => {
    expect(holdsPrompt(fixture(name), PROMPT)).toBe(false);
  });

  it('refuses when the user typed something else', () => {
    expect(holdsPrompt(`${RULE}\n❯ git status\n${RULE}`, PROMPT)).toBe(false);
  });

  it('refuses a prompt with nothing to compare', () => {
    expect(holdsPrompt(`${RULE}\n❯ \n${RULE}`, '\x1b')).toBe(false);
  });
});

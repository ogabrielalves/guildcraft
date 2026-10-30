// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision, PermissionRequestView } from '../../shared/permission.js';
import { PERMISSION_DESTINATIONS } from '../../shared/permission.js';
import { DICTIONARIES, initI18n, setLocale } from '../i18n/index.js';
import {
  INPUT_PREVIEW_LENGTH,
  createPermissionCard,
  destinationLabel,
  inputPreview,
} from './permission-card.js';

afterEach(() => {
  initI18n({ storage: null, languages: [] });
});

function request(overrides: Partial<PermissionRequestView> = {}): PermissionRequestView {
  return {
    id: 'r1',
    agentId: 'a',
    toolName: 'Bash',
    detail: 'rm -rf dist',
    input: '{"command":"rm -rf dist"}',
    subagent: null,
    suggestions: [],
    questions: null,
    createdAt: 1,
    expiresAt: 2,
    ...overrides,
  };
}

const question = (multiSelect = false): PermissionRequestView =>
  request({
    toolName: 'AskUserQuestion',
    detail: 'Pick one',
    input: null,
    questions: [
      {
        index: 0,
        question: 'Which database?',
        header: 'DB',
        multiSelect,
        options: [
          { label: 'SQLite', description: 'file' },
          { label: 'Postgres', description: '' },
          { label: 'MySQL', description: '' },
        ],
      },
    ],
  });

function setup() {
  const decisions: [string, PermissionDecision][] = [];
  const onTerminal = vi.fn();
  const card = createPermissionCard({
    decide: (id, decision) => decisions.push([id, decision]),
    onTerminal,
  });
  const query = (selector: string) => card.element.querySelector<HTMLElement>(selector);
  const input = () => card.element.querySelector<HTMLInputElement>('.request__other');
  const send = () => card.element.querySelector<HTMLButtonElement>('.request__button--send');
  const all = (selector: string) => [...card.element.querySelectorAll<HTMLButtonElement>(selector)];
  const click = (selector: string, index = 0) => {
    all(selector)[index]?.click();
  };
  return { card, decisions, onTerminal, query, input, send, all, click };
}

describe('helpers', () => {
  it('previews only input that adds to the detail', () => {
    expect(inputPreview(request())).toBe('{"command":"rm -rf dist"}');
    expect(inputPreview(request({ input: null }))).toBeNull();
    expect(inputPreview(request({ input: '' }))).toBeNull();
    expect(inputPreview(request({ input: 'rm -rf dist' }))).toBeNull();
    const long = 'x'.repeat(INPUT_PREVIEW_LENGTH + 10);
    expect(inputPreview(request({ input: long }))).toBe(`${'x'.repeat(INPUT_PREVIEW_LENGTH)}…`);
  });

  it.each(PERMISSION_DESTINATIONS)('labels destination %s in every locale', (destination) => {
    expect(DICTIONARIES.en.has(`request.destination.${destination}`)).toBe(true);
    expect(DICTIONARIES['pt-BR'].has(`request.destination.${destination}`)).toBe(true);
    expect(destinationLabel(destination)).not.toBe(`request.destination.${destination}`);
  });

  it.each([
    'permission',
    'question',
    'pending',
    'more',
    'subagent',
    'allow',
    'deny',
    'always',
    'send',
    'other',
    'terminal',
  ])('has request.%s in every locale', (key) => {
    expect(DICTIONARIES.en.has(`request.${key}`)).toBe(true);
    expect(DICTIONARIES['pt-BR'].has(`request.${key}`)).toBe(true);
  });
});

describe('createPermissionCard', () => {
  it('stays hidden without a request', () => {
    const { card } = setup();
    expect(card.element.hidden).toBe(true);
    card.show(request(), 0);
    card.show(null, 0);
    expect(card.element.hidden).toBe(true);
    expect(card.element.childElementCount).toBe(0);
  });

  it('shows the tool, detail, input and queue size', () => {
    const { card, query } = setup();
    card.show(request({ subagent: 'explorer' }), 2);
    expect(card.element.hidden).toBe(false);
    expect(query('.request__title')?.textContent).toBe('Asks to use a tool');
    expect(query('.request__tool')?.textContent).toBe('Bash · via explorer');
    expect(query('.request__detail')?.textContent).toBe('rm -rf dist');
    expect(query('.request__input')?.textContent).toBe('{"command":"rm -rf dist"}');
    expect(query('.request__more')?.textContent).toBe('+2 more');
    card.show(request({ subagent: 'explorer' }), 0);
    expect(query('.request__more')?.hidden).toBe(true);
  });

  it('allows once and locks until retried', () => {
    const { card, decisions, click, all } = setup();
    card.show(request(), 0);
    click('.request__button--allow');
    click('.request__button--allow');
    expect(decisions).toEqual([['r1', { behavior: 'allow' }]]);
    expect(card.sent()).toBe('r1');
    expect(all('.request__button').every((button) => button.disabled)).toBe(true);
    card.retry('other');
    expect(all('.request__button').every((button) => button.disabled)).toBe(true);
    card.retry('r1');
    expect(all('.request__button').some((button) => button.disabled)).toBe(false);
  });

  it('denies', () => {
    const { card, decisions, click } = setup();
    card.show(request(), 0);
    click('.request__button--deny');
    expect(decisions).toEqual([['r1', { behavior: 'deny' }]]);
  });

  it('offers the always-allow suggestions', () => {
    const { card, decisions, all, click } = setup();
    card.show(
      request({
        suggestions: [
          { index: 0, rules: ['Bash(npm:*)', 'Bash(git:*)'], destination: 'session' },
          { index: 1, rules: ['Bash(rm:*)'], destination: 'projectSettings' },
        ],
      }),
      0,
    );
    const buttons = all('.request__button--always');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Always allow Bash(npm:*), Bash(git:*)',
      'Always allow Bash(rm:*)',
    ]);
    expect(buttons[1]?.title).toBe('in project settings');
    click('.request__button--always', 1);
    expect(decisions).toEqual([['r1', { behavior: 'allow', suggestion: 1 }]]);
  });

  it('hands the request to the console', () => {
    const { card, decisions, onTerminal, click } = setup();
    card.show(request(), 0);
    click('.request__button--terminal');
    click('.request__button--terminal');
    expect(decisions).toEqual([['r1', { behavior: 'terminal' }]]);
    expect(onTerminal).toHaveBeenCalledOnce();
  });

  it('answers a single-select question', () => {
    const { card, decisions, query, send: sendButton, all, click } = setup();
    card.show(question(), 0);
    expect(query('.request__title')?.textContent).toBe('Has a question for you');
    expect(query('.request__button--allow')).toBeNull();
    expect(query('.request__input')).toBeNull();
    expect(query('.request__detail')?.textContent).toBe('Pick one');
    card.show(null, 0);
    card.show({ ...question(), id: 'r2', detail: 'Which database?' }, 0);
    expect(query('.request__detail')).toBeNull();
    card.show(question(), 0);
    expect(query('.request__question-header')?.textContent).toBe('DB');
    expect(all('.request__button--option')[0]?.title).toBe('file');
    const send = sendButton();
    expect(send?.disabled).toBe(true);
    click('.request__button--option', 0);
    click('.request__button--option', 1);
    expect(all('.request__button--option').map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    click('.request__button--option', 1);
    expect(send?.disabled).toBe(true);
    click('.request__button--option', 2);
    expect(send?.disabled).toBe(false);
    send?.click();
    expect(decisions).toEqual([
      ['r1', { behavior: 'answer', answers: [{ question: 0, options: [2] }] }],
    ]);
  });

  it('answers a multi-select question with an other text', () => {
    const { card, decisions, input, send, click } = setup();
    card.show(question(true), 0);
    click('.request__button--option', 2);
    click('.request__button--option', 0);
    click('.request__button--option', 1);
    click('.request__button--option', 1);
    const other = input();
    if (!other) throw new Error('missing other');
    other.value = '  Redis ';
    other.dispatchEvent(new Event('input'));
    send()?.click();
    expect(decisions).toEqual([
      ['r1', { behavior: 'answer', answers: [{ question: 0, options: [0, 2], other: 'Redis' }] }],
    ]);
  });

  it('accepts only an other text as an answer', () => {
    const { card, input, send } = setup();
    card.show(question(), 0);
    const other = input();
    if (!other) throw new Error('missing other');
    other.value = 'Mongo';
    other.dispatchEvent(new Event('input'));
    expect(send()?.disabled).toBe(false);
  });

  it('keeps the selection while the same request is shown again', () => {
    const { card, all, click } = setup();
    card.show(question(), 0);
    click('.request__button--option', 0);
    card.show(question(), 1);
    expect(all('.request__button--option')[0]?.getAttribute('aria-pressed')).toBe('true');
  });

  it('translates on renderTexts', () => {
    const { card, query } = setup();
    card.show(request(), 0);
    setLocale('pt-BR');
    card.renderTexts();
    expect(query('.request__button--allow')?.textContent).toBe(
      DICTIONARIES['pt-BR'].get('request.allow'),
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  MAX_INPUT_PREVIEW,
  MAX_SUGGESTIONS,
  answersFit,
  inputPreview,
  maskSecrets,
  parseHookBody,
  parseQuestions,
  pickSuggestions,
} from './request.js';

const QUESTION = {
  question: 'Which db?',
  header: 'DB',
  multiSelect: false,
  options: [{ label: 'Postgres', description: 'relational' }, { label: 'Mongo' }],
};

describe('maskSecrets', () => {
  it.each([
    ['curl -H "Authorization: Bearer abcdefghijkl"', 'curl -H "Authorization: Bearer ••••"'],
    ['export TOKEN=supersecret1', 'export TOKEN=••••'],
    ['key sk-abcdefghijklmnop', 'key ••••'],
    ['gh ghp_abcdefghijklmnop', 'gh ••••'],
    ['aws AKIAABCDEFGHIJKLMN', 'aws ••••'],
    ['npm test', 'npm test'],
  ])('masks %s', (raw, masked) => {
    expect(maskSecrets(raw)).toBe(masked);
  });
});

describe('inputPreview', () => {
  it('shows the command, file and edit parts', () => {
    expect(inputPreview('Bash', { command: 'npm test' })).toBe('npm test');
    expect(inputPreview('Write', { file_path: '/a.ts', content: 'x' })).toBe('/a.ts\n\nx');
    expect(inputPreview('Edit', { file_path: '/a.ts', old_string: 'a', new_string: 'b' })).toBe(
      '/a.ts\n---\na\n---\nb',
    );
  });

  it('falls back to json and skips questions and empty input', () => {
    expect(inputPreview('mcp__x__y', { id: 1 })).toBe('{\n  "id": 1\n}');
    expect(inputPreview('mcp__x__y', {})).toBeNull();
    expect(inputPreview('Bash', {})).toBeNull();
    expect(inputPreview('AskUserQuestion', { questions: [] })).toBeNull();
  });

  it('truncates long input', () => {
    const preview = inputPreview('Bash', { command: 'x'.repeat(MAX_INPUT_PREVIEW * 2) });
    expect(preview).toHaveLength(MAX_INPUT_PREVIEW);
    expect(preview?.endsWith('…')).toBe(true);
  });
});

describe('pickSuggestions', () => {
  it('keeps allow rules with a known destination, by original index', () => {
    expect(
      pickSuggestions([
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'localSettings',
          rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }, { toolName: 'Read' }, {}],
        },
        { type: 'addRules', behavior: 'deny', destination: 'session', rules: [{ toolName: 'X' }] },
        { type: 'addRules', behavior: 'allow', destination: 'cloud', rules: [{ toolName: 'X' }] },
        { type: 'addRules', behavior: 'allow', destination: 'session', rules: [] },
        { type: 'addRules', behavior: 'allow', destination: 'session', rules: 'x' },
        null,
      ]),
    ).toEqual([{ index: 1, rules: ['Bash(npm test:*)', 'Read'], destination: 'localSettings' }]);
  });

  it('caps the list and ignores non-arrays', () => {
    const rule = {
      type: 'addRules',
      behavior: 'allow',
      destination: 'session',
      rules: [{ toolName: 'Bash' }],
    };
    expect(pickSuggestions(Array.from({ length: 9 }, () => rule))).toHaveLength(MAX_SUGGESTIONS);
    expect(pickSuggestions('x')).toEqual([]);
  });
});

describe('parseQuestions', () => {
  it('reads questions with their options', () => {
    expect(parseQuestions({ questions: [QUESTION] })).toEqual([
      {
        index: 0,
        question: 'Which db?',
        header: 'DB',
        multiSelect: false,
        options: [
          { label: 'Postgres', description: 'relational' },
          { label: 'Mongo', description: '' },
        ],
      },
    ]);
  });

  it.each([
    {},
    { questions: [] },
    { questions: [QUESTION, QUESTION, QUESTION, QUESTION, QUESTION] },
    { questions: [null] },
    { questions: [{ question: 'x' }] },
    { questions: [{ question: ' ', options: [] }] },
    { questions: [{ question: 'x', options: [{}] }] },
    { questions: [{ question: 'x', options: [null] }] },
    { questions: [{ question: 'x', options: Array.from({ length: 9 }, () => ({ label: 'a' })) }] },
  ])('rejects %j', (input) => {
    expect(parseQuestions(input)).toBeNull();
  });
});

describe('parseHookBody', () => {
  it('reads a tool request from a subagent', () => {
    expect(
      parseHookBody({
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        agent_id: 'sub1',
        agent_type: 'Explore',
      }),
    ).toEqual({
      ok: true,
      body: {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        suggestions: [],
        questions: null,
        subagent: 'Explore',
      },
    });
  });

  it('names unknown subagents and defaults the input', () => {
    const parsed = parseHookBody({ tool_name: 'Bash', agent_id: 'x' });
    expect(parsed.ok && parsed.body.subagent).toBe('subagent');
    expect(parsed.ok && parsed.body.toolInput).toEqual({});
  });

  it('reads questions and refuses ones it cannot show', () => {
    const parsed = parseHookBody({
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [QUESTION] },
    });
    expect(parsed.ok && parsed.body.questions).toHaveLength(1);
    expect(parseHookBody({ tool_name: 'AskUserQuestion', tool_input: {} })).toEqual({
      ok: false,
      unsupported: true,
    });
  });

  it.each([null, [], {}, { tool_name: '' }])('rejects %j', (raw) => {
    expect(parseHookBody(raw)).toEqual({ ok: false, unsupported: false });
  });
});

describe('answersFit', () => {
  const questions = parseQuestions({
    questions: [QUESTION, { ...QUESTION, question: 'Which langs?', multiSelect: true }],
  });
  if (!questions) throw new Error('bad fixture');

  it('accepts one answer per question in the right shape', () => {
    expect(
      answersFit(questions, [
        { question: 0, options: [1] },
        { question: 1, options: [0, 1], other: 'Rust' },
      ]),
    ).toBe(true);
    expect(
      answersFit(questions, [
        { question: 0, options: [], other: 'SQLite' },
        { question: 1, options: [0] },
      ]),
    ).toBe(true);
  });

  it('rejects missing, extra or out-of-range answers', () => {
    expect(answersFit(questions, [{ question: 0, options: [0] }])).toBe(false);
    expect(
      answersFit(questions, [
        { question: 0, options: [0, 1] },
        { question: 1, options: [0] },
      ]),
    ).toBe(false);
    expect(
      answersFit(questions, [
        { question: 0, options: [5] },
        { question: 1, options: [0] },
      ]),
    ).toBe(false);
    expect(
      answersFit(questions, [
        { question: 3, options: [0] },
        { question: 1, options: [0] },
      ]),
    ).toBe(false);
    expect(
      answersFit(questions, [
        { question: 0, options: [0] },
        { question: 1, options: [] },
      ]),
    ).toBe(false);
  });
});

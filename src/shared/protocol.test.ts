import { describe, expect, it } from 'vitest';
import { MAX_AGENTS, MAX_NAME_LENGTH, MAX_TERM_COLS } from './constants.js';
import { decodeClientMessage, parseClientMessage } from './protocol.js';

describe('parseClientMessage', () => {
  it.each([
    { type: 'term:input', agentId: 'a1', data: 'ls\r' },
    { type: 'term:resize', agentId: 'a1', cols: 120, rows: 40 },
    { type: 'agent:create', name: 'Mortis', cwd: '/repo', skin: 'mortis', permissionMode: 'plan' },
    { type: 'agent:remove', agentId: 'a1' },
    { type: 'agent:removeAll' },
    { type: 'agent:restart', agentId: 'a1' },
    { type: 'agent:interrupt', agentId: 'a1' },
    { type: 'agent:setSkin', agentId: 'a1', skin: 'lyra' },
    { type: 'prompt:send', agentIds: ['a1', 'a2'], text: 'run the tests' },
  ])('accepts $type', (message) => {
    expect(parseClientMessage(message)).toEqual(message);
  });

  it('drops unknown fields', () => {
    expect(parseClientMessage({ type: 'agent:remove', agentId: 'a1', extra: true })).toEqual({
      type: 'agent:remove',
      agentId: 'a1',
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a missing type', { agentId: 'a1' }],
    ['an unknown type', { type: 'agent:explode' }],
    ['an empty agent id', { type: 'agent:remove', agentId: '' }],
    ['a non-string input', { type: 'term:input', agentId: 'a1', data: 42 }],
    ['zero columns', { type: 'term:resize', agentId: 'a1', cols: 0, rows: 40 }],
    ['fractional rows', { type: 'term:resize', agentId: 'a1', cols: 80, rows: 2.5 }],
    ['too many columns', { type: 'term:resize', agentId: 'a1', cols: MAX_TERM_COLS + 1, rows: 1 }],
    [
      'a long name',
      {
        type: 'agent:create',
        name: 'x'.repeat(MAX_NAME_LENGTH + 1),
        cwd: '/repo',
        skin: 'mortis',
        permissionMode: 'default',
      },
    ],
    [
      'an unknown permission mode',
      { type: 'agent:create', name: 'M', cwd: '/r', skin: 's', permissionMode: 'yolo' },
    ],
    ['a missing skin', { type: 'agent:setSkin', agentId: 'a1' }],
    ['no recipients', { type: 'prompt:send', agentIds: [], text: 'hi' }],
    [
      'too many recipients',
      {
        type: 'prompt:send',
        agentIds: Array.from({ length: MAX_AGENTS + 1 }, (_, i) => `a${i}`),
        text: 'hi',
      },
    ],
    ['a non-string recipient', { type: 'prompt:send', agentIds: [1], text: 'hi' }],
    ['an empty prompt', { type: 'prompt:send', agentIds: ['a1'], text: '' }],
  ])('rejects %s', (_, message) => {
    expect(parseClientMessage(message)).toBeNull();
  });
});

describe('decodeClientMessage', () => {
  it('parses valid json', () => {
    expect(decodeClientMessage('{"type":"agent:removeAll"}')).toEqual({ type: 'agent:removeAll' });
  });

  it('rejects malformed json', () => {
    expect(decodeClientMessage('{type:')).toBeNull();
  });
});

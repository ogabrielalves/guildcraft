import { describe, expect, it } from 'vitest';
import {
  MAX_DENY_MESSAGE_LENGTH,
  MAX_OTHER_ANSWER_LENGTH,
  parsePermissionDecision,
} from './permission.js';
import { parseClientMessage } from './protocol.js';

describe('parsePermissionDecision', () => {
  it.each([
    [{ behavior: 'allow' }, { behavior: 'allow' }],
    [
      { behavior: 'allow', suggestion: 1 },
      { behavior: 'allow', suggestion: 1 },
    ],
    [{ behavior: 'deny' }, { behavior: 'deny' }],
    [
      { behavior: 'deny', message: ' too risky ', interrupt: true },
      { behavior: 'deny', message: 'too risky', interrupt: true },
    ],
    [{ behavior: 'deny', message: '  ', interrupt: false }, { behavior: 'deny' }],
    [{ behavior: 'terminal' }, { behavior: 'terminal' }],
    [
      { behavior: 'answer', answers: [{ question: 0, options: [1] }] },
      { behavior: 'answer', answers: [{ question: 0, options: [1] }] },
    ],
    [
      { behavior: 'answer', answers: [{ question: 1, other: ' mine ' }] },
      { behavior: 'answer', answers: [{ question: 1, options: [], other: 'mine' }] },
    ],
  ])('accepts %j', (raw, expected) => {
    expect(parsePermissionDecision(raw)).toEqual(expected);
  });

  it.each([
    null,
    [],
    { behavior: 'maybe' },
    { behavior: 'allow', suggestion: -1 },
    { behavior: 'allow', suggestion: 1.5 },
    { behavior: 'deny', message: 3 },
    { behavior: 'deny', message: 'x'.repeat(MAX_DENY_MESSAGE_LENGTH + 1) },
    { behavior: 'deny', interrupt: 'yes' },
    { behavior: 'answer' },
    { behavior: 'answer', answers: [] },
    { behavior: 'answer', answers: [null] },
    { behavior: 'answer', answers: [{ question: 9, options: [0] }] },
    { behavior: 'answer', answers: [{ question: 0, options: 'a' }] },
    { behavior: 'answer', answers: [{ question: 0, options: [0, 0] }] },
    { behavior: 'answer', answers: [{ question: 0, options: [99] }] },
    { behavior: 'answer', answers: [{ question: 0 }] },
    { behavior: 'answer', answers: [{ question: 0, other: 5 }] },
    {
      behavior: 'answer',
      answers: [{ question: 0, other: 'x'.repeat(MAX_OTHER_ANSWER_LENGTH + 1) }],
    },
    {
      behavior: 'answer',
      answers: [
        { question: 0, options: [0] },
        { question: 0, options: [1] },
      ],
    },
  ])('rejects %j', (raw) => {
    expect(parsePermissionDecision(raw)).toBeNull();
  });
});

describe('permission:decide', () => {
  it('parses a decision for a request', () => {
    expect(
      parseClientMessage({
        type: 'permission:decide',
        requestId: 'p1',
        decision: { behavior: 'deny', interrupt: true },
      }),
    ).toEqual({
      type: 'permission:decide',
      requestId: 'p1',
      decision: { behavior: 'deny', interrupt: true },
    });
  });

  it('rejects a missing id or a bad decision', () => {
    expect(
      parseClientMessage({ type: 'permission:decide', decision: { behavior: 'allow' } }),
    ).toBeNull();
    expect(
      parseClientMessage({ type: 'permission:decide', requestId: 'p1', decision: {} }),
    ).toBeNull();
  });
});

import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { RelayInput } from './hook-relay.js';
import {
  MAX_FIELD_LENGTH,
  parseRelayArgs,
  readStream,
  relayHook,
  slimPayload,
} from './hook-relay.js';

describe('parseRelayArgs', () => {
  it('parses port, agent id and event', () => {
    expect(parseRelayArgs(['7777', 'a1', 'Stop'])).toEqual({
      port: 7777,
      agentId: 'a1',
      event: 'Stop',
    });
  });

  it.each([
    [[]],
    [['0', 'a1', 'Stop']],
    [['70000', 'a1', 'Stop']],
    [['77.5', 'a1', 'Stop']],
    [['7777', '../x', 'Stop']],
    [['7777', 'a1', 'Explode']],
    [['7777', 'a1']],
  ])('rejects %j', (args) => {
    expect(parseRelayArgs(args)).toBeNull();
  });
});

describe('slimPayload', () => {
  it('keeps only the fields the server reads', () => {
    const payload = slimPayload(
      JSON.stringify({
        session_id: 's',
        transcript_path: '/t',
        tool_name: 'Bash',
        tool_input: { command: 'ls', timeout: 5, nested: { a: 1 } },
        message: 'needs permission',
        notification_type: 'permission_prompt',
        source: 'startup',
      }),
    );
    expect(payload).toEqual({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      message: 'needs permission',
      notification_type: 'permission_prompt',
      source: 'startup',
    });
  });

  it('truncates long strings such as file contents', () => {
    const payload = slimPayload(
      JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: '/a.ts', content: 'x'.repeat(MAX_FIELD_LENGTH * 5) },
      }),
    );
    expect((payload.tool_input as Record<string, string>).content).toHaveLength(MAX_FIELD_LENGTH);
  });

  it.each(['', 'not json', '[1]', 'null', '{"tool_input": [1]}'])('falls back on %j', (text) => {
    expect(slimPayload(text)).toEqual({});
  });
});

describe('readStream', () => {
  it('joins string and buffer chunks', async () => {
    await expect(readStream(Readable.from([Buffer.from('{"a"'), ':1}']))).resolves.toBe('{"a":1}');
  });

  it('gives up on oversized input', async () => {
    await expect(readStream(Readable.from(['abc', 'def']), 4)).resolves.toBe('');
  });
});

function input(overrides: Partial<RelayInput> = {}) {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  const value: RelayInput = {
    args: ['7777', 'a1', 'PreToolUse'],
    env: { GUILDCRAFT_TOKEN: 'secret' },
    readStdin: () => Promise.resolve('{"tool_name":"Read","tool_input":{"file_path":"/a.ts"}}'),
    fetch: fetchMock,
    ...overrides,
  };
  return { value, fetchMock };
}

describe('relayHook', () => {
  it('posts the slim payload with the token', async () => {
    const { value, fetchMock } = input();
    await expect(relayHook(value)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7777/hook/a1/PreToolUse', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-guildcraft-token': 'secret' },
      body: '{"tool_name":"Read","tool_input":{"file_path":"/a.ts"}}',
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('skips the request without a token or with bad args', async () => {
    const noToken = input({ env: {} });
    const badArgs = input({ args: ['x'] });
    await expect(relayHook(noToken.value)).resolves.toBe(false);
    await expect(relayHook(badArgs.value)).resolves.toBe(false);
    expect(noToken.fetchMock).not.toHaveBeenCalled();
    expect(badArgs.fetchMock).not.toHaveBeenCalled();
  });

  it('reports a rejected request', async () => {
    const { value } = input({
      fetch: () => Promise.resolve(new Response(null, { status: 401 })),
    });
    await expect(relayHook(value)).resolves.toBe(false);
  });

  it('never throws when the server is down or stdin fails', async () => {
    const down = input({
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const broken = input({ readStdin: () => Promise.reject(new Error('EPIPE')) });
    await expect(relayHook(down.value)).resolves.toBe(false);
    await expect(relayHook(broken.value)).resolves.toBe(false);
  });
});

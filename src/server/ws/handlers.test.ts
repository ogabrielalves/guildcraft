import { describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '../../shared/protocol.js';
import type { CommandTarget } from './handlers.js';
import { handleClientMessage } from './handlers.js';

const OK = { ok: true, value: undefined } as const;

function target(): { [K in keyof CommandTarget]: ReturnType<typeof vi.fn> } {
  return {
    input: vi.fn(() => OK),
    resize: vi.fn(() => OK),
    create: vi.fn(() => Promise.resolve({ ok: true, value: {} })),
    remove: vi.fn(() => Promise.resolve(OK)),
    removeAll: vi.fn(() => Promise.resolve()),
    restart: vi.fn(() => Promise.resolve(OK)),
    interrupt: vi.fn(() => OK),
    setSkin: vi.fn(() => Promise.resolve(OK)),
    sendPrompt: vi.fn(() => ({ ok: true, value: [] })),
  };
}

const CASES: [ClientMessage, keyof CommandTarget, unknown[]][] = [
  [{ type: 'term:input', agentId: 'a', data: 'ls\r' }, 'input', ['a', 'ls\r']],
  [{ type: 'term:resize', agentId: 'a', cols: 80, rows: 24 }, 'resize', ['a', 80, 24]],
  [
    { type: 'agent:create', name: 'Lyra', cwd: '/repo', skin: 'lyra', permissionMode: 'plan' },
    'create',
    [{ name: 'Lyra', cwd: '/repo', skin: 'lyra', permissionMode: 'plan' }],
  ],
  [{ type: 'agent:remove', agentId: 'a' }, 'remove', ['a']],
  [{ type: 'agent:removeAll' }, 'removeAll', []],
  [{ type: 'agent:restart', agentId: 'a' }, 'restart', ['a']],
  [{ type: 'agent:interrupt', agentId: 'a' }, 'interrupt', ['a']],
  [{ type: 'agent:setSkin', agentId: 'a', skin: 'lyra' }, 'setSkin', ['a', 'lyra']],
  [{ type: 'prompt:send', agentIds: ['a', 'b'], text: 'go' }, 'sendPrompt', [['a', 'b'], 'go']],
];

describe('handleClientMessage', () => {
  it.each(CASES)('dispatches %o', async (message, method, args) => {
    const manager = target();
    await expect(handleClientMessage(manager, message)).resolves.toBeNull();
    expect(manager[method]).toHaveBeenCalledWith(...args);
  });

  it('returns the failure of a failed command', async () => {
    const manager = target();
    manager.restart.mockResolvedValue({ ok: false, code: 'SPAWN_FAILED' });
    manager.sendPrompt.mockReturnValue({ ok: false, code: 'QUEUE_FULL' });
    await expect(
      handleClientMessage(manager, { type: 'agent:restart', agentId: 'a' }),
    ).resolves.toEqual({ code: 'SPAWN_FAILED' });
    await expect(
      handleClientMessage(manager, { type: 'prompt:send', agentIds: ['a'], text: 'x' }),
    ).resolves.toEqual({ code: 'QUEUE_FULL' });
  });

  it('keeps the params of a failure', async () => {
    const manager = target();
    manager.create.mockResolvedValue({
      ok: false,
      code: 'AGENT_NAME_TAKEN',
      params: { name: 'Lyra' },
    });
    await expect(
      handleClientMessage(manager, {
        type: 'agent:create',
        name: 'Lyra',
        cwd: '/repo',
        skin: 'lyra',
        permissionMode: 'plan',
      }),
    ).resolves.toEqual({
      code: 'AGENT_NAME_TAKEN',
      params: { name: 'Lyra' },
    });
  });
});

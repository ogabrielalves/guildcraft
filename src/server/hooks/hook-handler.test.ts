import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../shared/agent.js';
import type { HookPayload } from './hook-handler.js';
import { handleHook, parseHookPayload } from './hook-handler.js';

const EMPTY: HookPayload = {
  toolName: null,
  toolInput: null,
  message: null,
  notificationType: null,
  source: null,
};

describe('parseHookPayload', () => {
  it('reads tool, message, notification type and source', () => {
    expect(
      parseHookPayload({
        session_id: 's',
        tool_name: 'Edit',
        tool_input: { file_path: '/a/App.tsx' },
        message: 'hi',
        notification_type: 'permission_prompt',
        source: 'startup',
      }),
    ).toEqual({
      toolName: 'Edit',
      toolInput: { file_path: '/a/App.tsx' },
      message: 'hi',
      notificationType: 'permission_prompt',
      source: 'startup',
    });
  });

  it.each([null, 'text', 42, [], {}])('returns an empty payload for %j', (raw) => {
    expect(parseHookPayload(raw)).toEqual(EMPTY);
  });

  it('ignores fields with the wrong type', () => {
    expect(
      parseHookPayload({ tool_name: 3, message: '', tool_input: undefined, source: false }),
    ).toEqual(EMPTY);
  });
});

describe('handleHook', () => {
  it.each<[Parameters<typeof handleHook>[0], AgentStatus]>([
    ['SessionStart', 'idle'],
    ['UserPromptSubmit', 'thinking'],
    ['PostToolUse', 'thinking'],
  ])('%s moves the agent to %s', (event, status) => {
    expect(handleHook(event, EMPTY, 'starting')).toEqual({ status, tool: null, event: null });
  });

  it.each(['startup', 'clear', 'resume'])('treats SessionStart from %s as idle', (source) => {
    expect(handleHook('SessionStart', { ...EMPTY, source }, 'thinking')?.status).toBe('idle');
  });

  it('keeps the current status on SessionStart after an auto compact', () => {
    expect(handleHook('SessionStart', { ...EMPTY, source: 'compact' }, 'tool')).toBeNull();
  });

  it('describes the tool on PreToolUse', () => {
    const payload = parseHookPayload({ tool_name: 'Bash', tool_input: { command: 'npm test' } });
    expect(handleHook('PreToolUse', payload, 'thinking')).toEqual({
      status: 'tool',
      tool: { name: 'Bash', detail: 'npm test' },
      event: null,
    });
  });

  it('falls back to a generic tool name', () => {
    expect(handleHook('PreToolUse', EMPTY, 'thinking')?.tool?.name).toBe('tool');
  });

  it('waits for the user when the agent asks a question', () => {
    const payload = parseHookPayload({ tool_name: 'AskUserQuestion', tool_input: {} });
    expect(handleHook('PreToolUse', payload, 'thinking')).toEqual({
      status: 'waiting',
      tool: { name: 'AskUserQuestion', detail: 'AskUserQuestion' },
      event: 'waiting',
    });
    expect(handleHook('PostToolUse', EMPTY, 'waiting')?.status).toBe('thinking');
  });

  it.each(['permission_prompt', 'elicitation_dialog'])(
    'waits for the user on %s notifications',
    (notificationType) => {
      expect(handleHook('Notification', { ...EMPTY, notificationType }, 'tool')).toEqual({
        status: 'waiting',
        tool: null,
        event: 'waiting',
      });
    },
  );

  it.each(['idle_prompt', 'auth_success'])('ignores %s notifications', (notificationType) => {
    const payload = { ...EMPTY, notificationType, message: 'needs your permission' };
    expect(handleHook('Notification', payload, 'idle')).toBeNull();
  });

  it('falls back to the message when the notification type is missing', () => {
    const payload = { ...EMPTY, message: 'Claude needs your permission to use Bash' };
    expect(handleHook('Notification', payload, 'tool')?.status).toBe('waiting');
    expect(
      handleHook('Notification', { ...EMPTY, message: 'waiting for your input' }, 'idle'),
    ).toBeNull();
    expect(handleHook('Notification', EMPTY, 'idle')).toBeNull();
  });

  it('finishes on Stop', () => {
    expect(handleHook('Stop', EMPTY, 'thinking')).toEqual({
      status: 'idle',
      tool: null,
      event: 'finished',
    });
  });

  it('ignores late hooks from an offline agent', () => {
    expect(handleHook('Stop', EMPTY, 'offline')).toBeNull();
  });
});

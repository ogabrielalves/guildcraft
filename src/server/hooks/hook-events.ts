export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export const TOOL_HOOK_EVENTS: readonly HookEvent[] = ['PreToolUse', 'PostToolUse'];

export function isHookEvent(value: unknown): value is HookEvent {
  return HOOK_EVENTS.some((event) => event === value);
}

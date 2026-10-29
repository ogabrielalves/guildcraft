export const ERROR_CODES = [
  'AGENT_NOT_FOUND',
  'AGENT_OFFLINE',
  'AGENT_ID_TAKEN',
  'AGENT_NAME_TAKEN',
  'AGENT_LIMIT_REACHED',
  'INVALID_NAME',
  'INVALID_CWD',
  'SKIN_NOT_FOUND',
  'SPAWN_FAILED',
  'CLAUDE_NOT_FOUND',
  'INVALID_MESSAGE',
  'EMPTY_PROMPT',
  'QUEUE_FULL',
  'UNAUTHORIZED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.some((code) => code === value);
}

export type ErrorParams = Record<string, string>;

export interface Failure {
  code: ErrorCode;
  params?: ErrorParams;
}

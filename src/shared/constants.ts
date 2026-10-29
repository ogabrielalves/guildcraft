export const MAX_AGENTS = 8;
export const DEFAULT_PORT = 7777;
export const DEFAULT_HOST = '127.0.0.1';
export const ENV_PREFIX = 'GUILDCRAFT_';

export const TOKEN_HEADER = 'x-guildcraft-token';
export const TOKEN_QUERY = 'token';
export const UNAUTHORIZED_CLOSE_CODE = 4401;

export const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_NAME_LENGTH = 32;
export const MAX_PATH_LENGTH = 4096;
export const MAX_PROMPT_LENGTH = 100_000;
export const MAX_QUEUED = 50;
export const MAX_EVENTS = 50;
export const MAX_TERM_INPUT_LENGTH = 65_536;
export const MAX_TERM_COLS = 1000;
export const MAX_TERM_ROWS = 500;

export const LOCALES = ['en', 'pt-BR'] as const;
export type Locale = (typeof LOCALES)[number];

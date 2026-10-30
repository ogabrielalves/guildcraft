export const PERMISSION_DESTINATIONS = [
  'session',
  'localSettings',
  'projectSettings',
  'userSettings',
] as const;
export type PermissionDestination = (typeof PERMISSION_DESTINATIONS)[number];

export interface PermissionSuggestion {
  index: number;
  rules: string[];
  destination: PermissionDestination;
}

export interface PermissionQuestionOption {
  label: string;
  description: string;
}

export interface PermissionQuestion {
  index: number;
  question: string;
  header: string;
  multiSelect: boolean;
  options: PermissionQuestionOption[];
}

export interface PermissionRequestView {
  id: string;
  agentId: string;
  toolName: string;
  detail: string;
  input: string | null;
  subagent: string | null;
  suggestions: PermissionSuggestion[];
  questions: PermissionQuestion[] | null;
  createdAt: number;
  expiresAt: number;
}

export interface PermissionAnswer {
  question: number;
  options: number[];
  other?: string;
}

export type PermissionDecision =
  | { behavior: 'allow'; suggestion?: number }
  | { behavior: 'deny'; message?: string; interrupt?: boolean }
  | { behavior: 'answer'; answers: PermissionAnswer[] }
  | { behavior: 'terminal' };

export const PERMISSION_OUTCOMES = [
  'allowed',
  'denied',
  'answered',
  'terminal',
  'released',
] as const;
export type PermissionOutcome = (typeof PERMISSION_OUTCOMES)[number];

export const MAX_DENY_MESSAGE_LENGTH = 1_000;
export const MAX_OTHER_ANSWER_LENGTH = 2_000;
export const MAX_QUESTIONS = 4;
export const MAX_QUESTION_OPTIONS = 8;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max;
}

function parseAnswer(raw: unknown): PermissionAnswer | null {
  if (!isRecord(raw) || !isIndex(raw.question, MAX_QUESTIONS)) return null;
  const options = raw.options ?? [];
  if (!Array.isArray(options) || options.length > MAX_QUESTION_OPTIONS) return null;
  if (!options.every((option) => isIndex(option, MAX_QUESTION_OPTIONS))) return null;
  if (new Set(options).size !== options.length) return null;
  const answer: PermissionAnswer = { question: raw.question, options: options };
  if (raw.other !== undefined) {
    if (typeof raw.other !== 'string' || raw.other.length > MAX_OTHER_ANSWER_LENGTH) return null;
    if (raw.other.trim() !== '') answer.other = raw.other.trim();
  }
  return answer.options.length > 0 || answer.other !== undefined ? answer : null;
}

function parseAnswers(raw: unknown): PermissionAnswer[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUESTIONS) return null;
  const answers = raw.map(parseAnswer);
  if (answers.some((answer) => answer === null)) return null;
  const valid = answers as PermissionAnswer[];
  return new Set(valid.map((answer) => answer.question)).size === valid.length ? valid : null;
}

function parseDeny(raw: Fields): PermissionDecision | null {
  const decision: { behavior: 'deny'; message?: string; interrupt?: boolean } = {
    behavior: 'deny',
  };
  if (raw.message !== undefined) {
    if (typeof raw.message !== 'string' || raw.message.length > MAX_DENY_MESSAGE_LENGTH) {
      return null;
    }
    if (raw.message.trim() !== '') decision.message = raw.message.trim();
  }
  if (raw.interrupt !== undefined) {
    if (typeof raw.interrupt !== 'boolean') return null;
    if (raw.interrupt) decision.interrupt = true;
  }
  return decision;
}

export function parsePermissionDecision(raw: unknown): PermissionDecision | null {
  if (!isRecord(raw)) return null;
  switch (raw.behavior) {
    case 'allow':
      if (raw.suggestion === undefined) return { behavior: 'allow' };
      return isIndex(raw.suggestion, Number.MAX_SAFE_INTEGER)
        ? { behavior: 'allow', suggestion: raw.suggestion }
        : null;
    case 'deny':
      return parseDeny(raw);
    case 'answer': {
      const answers = parseAnswers(raw.answers);
      return answers ? { behavior: 'answer', answers } : null;
    }
    case 'terminal':
      return { behavior: 'terminal' };
    default:
      return null;
  }
}

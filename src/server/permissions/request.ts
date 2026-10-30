import type {
  PermissionAnswer,
  PermissionDestination,
  PermissionQuestion,
  PermissionSuggestion,
} from '../../shared/permission.js';
import {
  MAX_QUESTION_OPTIONS,
  MAX_QUESTIONS,
  PERMISSION_DESTINATIONS,
} from '../../shared/permission.js';

export const QUESTION_TOOL = 'AskUserQuestion';
export const MAX_INPUT_PREVIEW = 2_000;
export const MAX_SUGGESTIONS = 4;
export const MAX_RULES = 4;
export const MAX_RULE_LENGTH = 200;
export const MAX_QUESTION_TEXT = 500;

type Fields = Record<string, unknown>;

export interface PermissionHookBody {
  toolName: string;
  toolInput: Fields;
  suggestions: PermissionSuggestion[];
  questions: PermissionQuestion[] | null;
  subagent: string | null;
}

export type ParsedBody =
  { ok: true; body: PermissionHookBody } | { ok: false; unsupported: boolean };

const MASK = '••••';
const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\bsk-[A-Za-z0-9_-]{8,}/g, MASK],
  [/\bgh[pousr]_[A-Za-z0-9]{8,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{8,}/g, MASK],
  [/\bAKIA[A-Z0-9]{12,}/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, MASK],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`],
  [/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*)["']?[^\s"'&]{4,}/gi, `$1${MASK}`],
];

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : null;
}

export function maskSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (masked, [pattern, replacement]) => masked.replace(pattern, replacement),
    value,
  );
}

function clip(value: string, max = MAX_INPUT_PREVIEW): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function inputPreview(toolName: string, input: Fields): string | null {
  const field = (key: string) => (typeof input[key] === 'string' ? input[key] : null);
  let preview: string | null;
  switch (toolName) {
    case 'Bash':
      preview = field('command');
      break;
    case 'Write':
      preview = [field('file_path'), field('content')].filter(Boolean).join('\n\n');
      break;
    case 'Edit':
      preview = [field('file_path'), field('old_string'), field('new_string')]
        .filter((part) => part !== null)
        .join('\n---\n');
      break;
    case QUESTION_TOOL:
      return null;
    default:
      preview = Object.keys(input).length > 0 ? JSON.stringify(input, null, 2) : null;
  }
  return preview ? clip(maskSecrets(preview)) : null;
}

function isDestination(value: unknown): value is PermissionDestination {
  return PERMISSION_DESTINATIONS.some((destination) => destination === value);
}

function ruleText(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const tool = text(raw.toolName, MAX_RULE_LENGTH);
  if (!tool) return null;
  const content = text(raw.ruleContent, MAX_RULE_LENGTH);
  return clip(maskSecrets(content ? `${tool}(${content})` : tool), MAX_RULE_LENGTH);
}

export function pickSuggestions(raw: unknown): PermissionSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const picked: PermissionSuggestion[] = [];
  raw.forEach((entry: unknown, index) => {
    if (picked.length >= MAX_SUGGESTIONS || !isRecord(entry)) return;
    if (entry.type !== 'addRules' || entry.behavior !== 'allow') return;
    if (!isDestination(entry.destination) || !Array.isArray(entry.rules)) return;
    const rules = entry.rules.map(ruleText).filter((rule): rule is string => rule !== null);
    if (rules.length > 0) {
      picked.push({ index, rules: rules.slice(0, MAX_RULES), destination: entry.destination });
    }
  });
  return picked;
}

function parseQuestion(raw: unknown, index: number): PermissionQuestion | null {
  if (!isRecord(raw)) return null;
  const question = text(raw.question, MAX_QUESTION_TEXT);
  if (!question || !Array.isArray(raw.options)) return null;
  if (raw.options.length > MAX_QUESTION_OPTIONS) return null;
  const options = raw.options.map((option: unknown) => {
    if (!isRecord(option)) return null;
    const label = text(option.label, MAX_QUESTION_TEXT);
    return label
      ? {
          label: maskSecrets(label),
          description: maskSecrets(text(option.description, MAX_QUESTION_TEXT) ?? ''),
        }
      : null;
  });
  if (options.some((option) => option === null)) return null;
  return {
    index,
    question: maskSecrets(question),
    header: maskSecrets(text(raw.header, MAX_QUESTION_TEXT) ?? ''),
    multiSelect: raw.multiSelect === true,
    options: options as PermissionQuestion['options'],
  };
}

export function parseQuestions(input: Fields): PermissionQuestion[] | null {
  const raw = input.questions;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_QUESTIONS) return null;
  const questions = raw.map(parseQuestion);
  if (questions.some((question) => question === null)) return null;
  return questions as PermissionQuestion[];
}

export function parseHookBody(raw: unknown): ParsedBody {
  if (!isRecord(raw)) return { ok: false, unsupported: false };
  const toolName = text(raw.tool_name, 200);
  if (!toolName) return { ok: false, unsupported: false };
  const toolInput = isRecord(raw.tool_input) ? raw.tool_input : {};
  const questions = toolName === QUESTION_TOOL ? parseQuestions(toolInput) : null;
  if (toolName === QUESTION_TOOL && !questions) return { ok: false, unsupported: true };
  return {
    ok: true,
    body: {
      toolName,
      toolInput,
      suggestions: pickSuggestions(raw.permission_suggestions),
      questions,
      subagent: typeof raw.agent_id === 'string' ? (text(raw.agent_type, 64) ?? 'subagent') : null,
    },
  };
}

export function answersFit(
  questions: readonly PermissionQuestion[],
  answers: readonly PermissionAnswer[],
): boolean {
  if (answers.length !== questions.length) return false;
  return answers.every((answer) => {
    const question = questions[answer.question];
    if (!question) return false;
    if (answer.options.some((option) => option >= question.options.length)) return false;
    const picks = answer.options.length + (answer.other === undefined ? 0 : 1);
    return question.multiSelect ? picks > 0 : picks === 1;
  });
}

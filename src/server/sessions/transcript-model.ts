export const MAX_MODEL_LENGTH = 100;

const SYNTHETIC_MODEL = '<synthetic>';

export interface ModelInfo {
  model: string;
  effort: string | null;
}

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function label(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > MAX_MODEL_LENGTH ? null : trimmed;
}

function modelOf(line: string): ModelInfo | null {
  if (!line.includes('"assistant"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.type !== 'assistant' || raw.isSidechain === true) return null;
  if (!isRecord(raw.message)) return null;
  const model = label(raw.message.model);
  if (model === null || model === SYNTHETIC_MODEL) return null;
  return { model, effort: label(raw.effort) };
}

export function latestModel(lines: readonly string[]): ModelInfo | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const info = modelOf(lines[index] ?? '');
    if (info) return info;
  }
  return null;
}

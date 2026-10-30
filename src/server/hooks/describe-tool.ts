import { maskSecrets } from './mask-secrets.js';

export const MAX_DESCRIPTION_LENGTH = 40;
const MAX_SCANNED_LENGTH = 4_000;

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write']);
const PATTERN_TOOLS = new Set(['Grep', 'Glob']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

export function describeTool(toolName: string, toolInput: unknown): string {
  return truncate(maskSecrets(describe(toolName, toolInput) ?? fallbackName(toolName)));
}

function describe(toolName: string, toolInput: unknown): string | null {
  if (FILE_TOOLS.has(toolName)) return mapField(toolInput, 'file_path', baseName);
  if (toolName === 'NotebookEdit') return mapField(toolInput, 'notebook_path', baseName);
  if (PATTERN_TOOLS.has(toolName)) return mapField(toolInput, 'pattern', collapseWhitespace);
  if (SHELL_TOOLS.has(toolName)) return mapField(toolInput, 'command', collapseWhitespace);
  if (toolName === 'WebFetch') return mapField(toolInput, 'url', hostOf);
  if (toolName === 'WebSearch') return mapField(toolInput, 'query', collapseWhitespace);
  return null;
}

function mapField(input: unknown, key: string, format: (value: string) => string): string | null {
  if (typeof input !== 'object' || input === null) return null;
  const value: unknown = (input as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const formatted = format(value);
  return formatted === '' ? null : formatted;
}

function fallbackName(toolName: string): string {
  const parts = toolName.split('__');
  if (parts[0] === 'mcp' && parts.length >= 3) return parts.slice(2).join('__');
  return toolName;
}

function baseName(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function collapseWhitespace(text: string): string {
  return text.slice(0, MAX_SCANNED_LENGTH).replace(/\s+/g, ' ').trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return collapseWhitespace(url);
  }
}

function truncate(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= MAX_DESCRIPTION_LENGTH) return text;
  return `${chars.slice(0, MAX_DESCRIPTION_LENGTH - 1).join('')}…`;
}

import { win32 } from 'node:path';

export function systemTool(env: Record<string, string | undefined>, name: string): string {
  return win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows', 'System32', name);
}

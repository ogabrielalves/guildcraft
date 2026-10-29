import { describe, expect, it } from 'vitest';
import { systemTool } from './system-tool.js';

describe('systemTool', () => {
  it.each([
    [{ SystemRoot: String.raw`D:\Win` }, String.raw`D:\Win\System32\cmd.exe`],
    [{ SYSTEMROOT: String.raw`E:\W` }, String.raw`E:\W\System32\cmd.exe`],
    [{}, String.raw`C:\Windows\System32\cmd.exe`],
  ])('resolves cmd.exe inside the system folder for %o', (env, expected) => {
    expect(systemTool(env, 'cmd.exe')).toBe(expected);
  });
});

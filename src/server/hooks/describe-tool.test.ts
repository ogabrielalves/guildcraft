import { describe, expect, it } from 'vitest';
import { MAX_DESCRIPTION_LENGTH, describeTool } from './describe-tool.js';

describe('describeTool', () => {
  it.each(['Read', 'Edit', 'MultiEdit', 'Write'])('shows the file name for %s', (tool) => {
    expect(describeTool(tool, { file_path: '/repo/src/App.tsx' })).toBe('App.tsx');
  });

  it('handles windows paths', () => {
    expect(describeTool('Edit', { file_path: String.raw`C:\repo\src\main.ts` })).toBe('main.ts');
  });

  it('shows the notebook name for NotebookEdit', () => {
    expect(describeTool('NotebookEdit', { notebook_path: '/n/analysis.ipynb' })).toBe(
      'analysis.ipynb',
    );
  });

  it('shows the bash command on one line', () => {
    expect(describeTool('Bash', { command: 'npm   test\n  -- --run' })).toBe('npm test -- --run');
  });

  it('shows the PowerShell command', () => {
    expect(describeTool('PowerShell', { command: 'Get-ChildItem  src' })).toBe('Get-ChildItem src');
  });

  it('masks secrets in commands', () => {
    expect(describeTool('Bash', { command: 'GITHUB_TOKEN=abc123 gh pr list' })).toBe(
      'GITHUB_TOKEN=*** gh pr list',
    );
  });

  it.each(['Grep', 'Glob'])('shows the pattern for %s', (tool) => {
    expect(describeTool(tool, { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('shows the host for WebFetch', () => {
    expect(describeTool('WebFetch', { url: 'https://docs.example.com/a/b?c=1' })).toBe(
      'docs.example.com',
    );
  });

  it('keeps an unparsable WebFetch url', () => {
    expect(describeTool('WebFetch', { url: 'not a url' })).toBe('not a url');
  });

  it('shows the query for WebSearch', () => {
    expect(describeTool('WebSearch', { query: 'vitest coverage' })).toBe('vitest coverage');
  });

  it('shows the tool part of mcp tool names', () => {
    expect(describeTool('mcp__guildcraft__send_message', { to: 'x' })).toBe('send_message');
  });

  it('keeps double underscores inside mcp tool names', () => {
    expect(describeTool('mcp__srv__do__it', {})).toBe('do__it');
  });

  it('falls back to the tool name for unknown tools', () => {
    expect(describeTool('TodoWrite', { todos: [] })).toBe('TodoWrite');
  });

  it.each([null, undefined, 'x', 42, {}, { file_path: 7 }, { file_path: '   ' }])(
    'falls back to the tool name on malformed input %s',
    (input) => {
      expect(describeTool('Read', input)).toBe('Read');
    },
  );

  it('truncates long descriptions with an ellipsis', () => {
    const result = describeTool('Bash', { command: 'x'.repeat(100) });
    expect(Array.from(result)).toHaveLength(MAX_DESCRIPTION_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });

  it('keeps descriptions at the limit untouched', () => {
    const command = 'y'.repeat(MAX_DESCRIPTION_LENGTH);
    expect(describeTool('Bash', { command })).toBe(command);
  });

  it('does not split surrogate pairs when truncating', () => {
    const result = describeTool('WebSearch', { query: '🔥'.repeat(60) });
    expect(result).toBe(`${'🔥'.repeat(MAX_DESCRIPTION_LENGTH - 1)}…`);
  });
});

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./mcp.ts', import.meta.url));

const ENV = {
  GUILDCRAFT_PORT: '7777',
  GUILDCRAFT_AGENT_ID: 'a1',
  GUILDCRAFT_TOKEN: 'secret',
};

function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  return { child, out: () => stdout, err: () => stderr };
}

it('speaks only json-rpc on stdout', async () => {
  const { child, out } = start(ENV);
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    })}\n`,
  );
  await expect.poll(() => out().includes('\n'), { timeout: 15_000, interval: 50 }).toBe(true);
  child.kill();
  const lines = out().trim().split('\n');
  expect(lines).toHaveLength(1);
  const reply = JSON.parse(lines[0] ?? '') as { id: number; result: { serverInfo: unknown } };
  expect(reply.id).toBe(1);
  expect(reply.result.serverInfo).toMatchObject({ name: 'guildcraft' });
}, 20_000);

it('exits with an error on stderr when the environment is incomplete', async () => {
  const { child, out, err } = start({ GUILDCRAFT_PORT: '7777' });
  const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
  expect(code).toBe(1);
  expect(out()).toBe('');
  expect(err()).toContain('missing port, agent id or token');
}, 20_000);

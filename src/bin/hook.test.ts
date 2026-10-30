import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./hook.ts', import.meta.url));

interface Received {
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let port: number;
let received: Received[];
let reply: (req: IncomingMessage) => { status: number; body?: unknown };

beforeEach(async () => {
  received = [];
  reply = () => ({ status: 204 });
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      received.push({ url: req.url, headers: req.headers, body });
      const answer = reply(req);
      res.statusCode = answer.status;
      res.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function run(args: string[], stdin: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
      env: { ...process.env, GUILDCRAFT_TOKEN: 'secret', ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('close', (code) => {
      resolve({ code, stdout });
    });
    child.stdin.end(stdin);
  });
}

it('relays the hook and exits silently', async () => {
  const result = await run([String(port), 'a1', 'Stop'], '{"session_id":"s"}');
  expect(result).toEqual({ code: 0, stdout: '' });
  expect(received).toHaveLength(1);
  expect(received[0]?.url).toBe('/hook/a1/Stop');
  expect(received[0]?.headers['x-guildcraft-token']).toBe('secret');
  expect(received[0]?.headers['content-type']).toBe('application/json');
  expect(received[0]?.body).toBe('{"session_id":"s"}');
}, 20_000);

it('exits cleanly when the server is unreachable', async () => {
  const closed = String(port);
  await new Promise((resolve) => server.close(resolve));
  server = createServer();
  server.listen(0, '127.0.0.1');
  const result = await run([closed, 'a1', 'Stop'], '{}');
  expect(result).toEqual({ code: 0, stdout: '' });
}, 20_000);

it('prints the decision of a permission request', async () => {
  reply = (req) =>
    req.method === 'POST'
      ? { status: 201, body: { id: 'p1', expiresAt: 1 } }
      : { status: 200, body: { status: 'decided', decision: { behavior: 'allow' } } };
  const stdin = JSON.stringify({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
  });
  const result = await run([String(port), 'a1', 'PermissionRequest'], stdin);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
  });
  expect(received.map((entry) => entry.url)).toEqual([
    '/hook/a1/permission',
    '/hook/a1/permission/p1?timeout=25',
  ]);
}, 20_000);

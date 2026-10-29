import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AgentView } from '../../src/shared/agent.js';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol.js';
import { startServer } from '../../src/server/index.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const FAKE_CLAUDE = fileURLToPath(new URL('./fake-claude.js', import.meta.url));
const TSX_API = pathToFileURL(join(REPO, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs'));
const HOOK_SOURCE = pathToFileURL(join(REPO, 'src', 'bin', 'hook.ts'));
const WAIT = { timeout: 20_000, interval: 50 };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'guildcraft-e2e-'));
  await mkdir(join(root, 'assets', 'characters', 'oren'), { recursive: true });
  await writeFile(join(root, 'assets', 'characters', 'oren', 'oren.json'), '{}');
  await mkdir(join(root, 'dist', 'bin'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{ "type": "module" }');
  await writeFile(
    join(root, 'dist', 'bin', 'hook.js'),
    `import { tsImport } from '${TSX_API.href}';\nawait tsImport('${HOOK_SOURCE.href}', import.meta.url);\n`,
  );
  await mkdir(join(root, 'work'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function agentNamed(messages: ServerMessage[], name: string): AgentView | undefined {
  return messages
    .flatMap((message) => (message.type === 'agent:updated' ? [message.agent] : []))
    .findLast((agent) => agent.name === name);
}

function outputOf(messages: ServerMessage[]): string {
  return messages
    .flatMap((message) => (message.type === 'term:output' ? [message.data] : []))
    .join('');
}

it('runs an agent from creation to a clean shutdown when the ui closes', async () => {
  const exit = vi.fn();
  const { port, token } = await startServer(
    { port: 0, open: false, claudeBin: null, dataDir: join(root, 'data') },
    {
      rootDir: root,
      devMode: false,
      env: process.env,
      findClaude: () => ({ command: process.execPath, args: [FAKE_CLAUDE] }),
      signals: null,
      exit,
      log: () => undefined,
      graceMs: 50,
    },
  );
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`, {
    origin: `http://127.0.0.1:${port}`,
  });
  const messages: ServerMessage[] = [];
  socket.on('message', (data: Buffer) => {
    messages.push(JSON.parse(data.toString()) as ServerMessage);
  });
  await new Promise((resolve) => socket.once('open', resolve));
  const send = (message: ClientMessage) => {
    socket.send(JSON.stringify(message));
  };

  const create = {
    type: 'agent:create',
    name: 'Mortis',
    cwd: join(root, 'work'),
    skin: 'oren',
    permissionMode: 'default',
  } as const;
  send(create);
  const agent = await vi.waitFor(() => {
    const view = agentNamed(messages, 'Mortis');
    if (view?.status !== 'idle') throw new Error('agent is not idle yet');
    return view;
  }, WAIT);
  const [rootPid, helperPid] = await vi.waitFor(() => {
    const match = /pids (\d+) (\d+)/.exec(outputOf(messages));
    expect(match).not.toBeNull();
    return [Number(match?.[1]), Number(match?.[2])] as const;
  }, WAIT);
  expect(isAlive(helperPid)).toBe(true);

  send({ ...create, name: 'mortis' });
  await vi.waitFor(() => {
    expect(messages).toContainEqual({
      type: 'error',
      code: 'AGENT_NAME_TAKEN',
      source: 'agent:create',
      params: { name: 'mortis' },
    });
  }, WAIT);

  const statusesBefore = messages.length;
  send({ type: 'prompt:send', agentIds: [agent.id], text: 'hello there' });
  await vi.waitFor(() => {
    expect(outputOf(messages)).toContain('reply: hello there');
    expect(agentNamed(messages, 'Mortis')?.status).toBe('idle');
  }, WAIT);
  const statuses = messages
    .slice(statusesBefore)
    .flatMap((message) => (message.type === 'agent:updated' ? [message.agent.status] : []));
  expect(statuses).toContain('thinking');
  expect(outputOf(messages).match(/reply: /g)).toHaveLength(1);

  socket.close();
  await vi.waitFor(() => {
    expect(exit).toHaveBeenCalledWith(0);
  }, WAIT);
  await vi.waitFor(() => {
    expect([isAlive(rootPid), isAlive(helperPid)]).toEqual([false, false]);
  }, WAIT);
}, 60_000);

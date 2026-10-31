import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Villager } from '../http/routes/villagers.js';
import type { VillageApi } from './village-tools.js';
import {
  createVillageApi,
  createVillageServer,
  describeVillager,
  errorText,
  sentText,
} from './village-tools.js';

const CORVIN: Villager = {
  name: 'Corvin',
  cwd: '/repo/web',
  status: 'tool',
  doing: 'Edit: App.tsx',
  queued: 2,
};

let client: Client | null = null;

async function connect(api: Partial<VillageApi>, name?: string) {
  const full: VillageApi = {
    listVillagers: vi.fn(() => Promise.resolve({ ok: true as const, value: [] })),
    sendMessage: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { queued: 1, busy: false } }),
    ),
    ...api,
  };
  const server = createVillageServer(full, '1.2.3', name);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, api: full };
}

async function call(name: string, args: Record<string, unknown> = {}) {
  if (!client) throw new Error('not connected');
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const first = result.content[0];
  return { text: first?.type === 'text' ? first.text : '', isError: result.isError === true };
}

afterEach(async () => {
  await client?.close();
  client = null;
});

describe('village server', () => {
  it('tells the agent its own name through the server instructions', async () => {
    const { client } = await connect({}, 'Mortis');
    expect(client.getInstructions()).toContain('"Mortis"');
  });

  it('lists both tools with english descriptions', async () => {
    const { client } = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['list_villagers', 'send_message']);
    expect(tools[1]?.inputSchema.required).toEqual(['to', 'message']);
    expect(client.getServerVersion()).toMatchObject({ name: 'guildcraft', version: '1.2.3' });
  });

  it('lists the other villagers', async () => {
    await connect({
      listVillagers: () =>
        Promise.resolve({
          ok: true,
          value: [CORVIN, { ...CORVIN, name: 'Lyra', status: 'idle', doing: null, queued: 0 }],
        }),
    });
    expect(await call('list_villagers')).toEqual({
      text: '- Corvin (tool, doing Edit: App.tsx, 2 queued) in /repo/web\n- Lyra (idle) in /repo/web',
      isError: false,
    });
  });

  it('says when the workshop is empty', async () => {
    await connect({});
    expect((await call('list_villagers')).text).toBe('No other villagers are in the workshop.');
  });

  it('reports list failures as tool errors', async () => {
    await connect({ listVillagers: () => Promise.resolve({ ok: false, code: 'UNREACHABLE' }) });
    expect(await call('list_villagers')).toEqual({
      text: 'Could not reach Guildcraft. It may have been closed.',
      isError: true,
    });
  });

  it('sends a message', async () => {
    const { api } = await connect({});
    expect(await call('send_message', { to: 'Corvin', message: 'api is ready' })).toEqual({
      text: 'Message sent to Corvin. They will read it in a moment.',
      isError: false,
    });
    expect(api.sendMessage).toHaveBeenCalledWith('Corvin', 'api is ready');
  });

  it.each(['AGENT_NOT_FOUND', 'AGENT_OFFLINE', 'QUEUE_FULL', 'EMPTY_PROMPT'] as const)(
    'turns %s into a clear error',
    async (code) => {
      await connect({ sendMessage: () => Promise.resolve({ ok: false, code }) });
      expect(await call('send_message', { to: 'Corvin', message: 'hi' })).toEqual({
        text: errorText(code, 'Corvin'),
        isError: true,
      });
    },
  );

  it('rejects arguments outside the schema without calling the api', async () => {
    const { api } = await connect({});
    expect((await call('send_message', { to: '', message: 'hi' })).isError).toBe(true);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('texts', () => {
  it('describes a busy recipient', () => {
    expect(sentText('Corvin', { queued: 3, busy: true })).toBe(
      'Corvin is busy. The message is queued (position 3) and will be delivered when they finish.',
    );
  });

  it('describes an idle villager without extras', () => {
    expect(describeVillager({ ...CORVIN, doing: null, queued: 0, status: 'idle' })).toBe(
      '- Corvin (idle) in /repo/web',
    );
  });

  it.each([
    ['AGENT_NOT_FOUND', undefined, 'Guildcraft no longer knows this agent'],
    ['AGENT_NOT_FOUND', 'Bob', 'There is no villager named "Bob"'],
    ['AGENT_OFFLINE', undefined, 'That villager is offline'],
    ['QUEUE_FULL', 'Bob', 'Bob has too many pending messages'],
    ['INVALID_MESSAGE', 'Bob', 'The message was rejected'],
    ['UNAUTHORIZED', undefined, 'Guildcraft rejected the session token'],
    ['SPAWN_FAILED', undefined, 'Guildcraft rejected the request (SPAWN_FAILED)'],
  ] as const)('explains %s', (code, to, start) => {
    expect(errorText(code, to)).toContain(start);
  });
});

describe('village api', () => {
  const OPTIONS = { port: 7777, agentId: 'a1', token: 'secret' };

  function respond(status: number, body: unknown) {
    return vi.fn(() =>
      Promise.resolve(new Response(body === undefined ? 'oops' : JSON.stringify(body), { status })),
    );
  }

  it('lists villagers with the token', async () => {
    const fetchMock = respond(200, [CORVIN]);
    const api = createVillageApi({ ...OPTIONS, fetch: fetchMock });
    await expect(api.listVillagers()).resolves.toEqual({ ok: true, value: [CORVIN] });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7777/api/a1/villagers', {
      headers: { 'content-type': 'application/json', 'x-guildcraft-token': 'secret' },
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  it('posts messages', async () => {
    const fetchMock = respond(200, { queued: 1, busy: true });
    const api = createVillageApi({ ...OPTIONS, fetch: fetchMock });
    await expect(api.sendMessage('Corvin', 'hi')).resolves.toEqual({
      ok: true,
      value: { queued: 1, busy: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:7777/api/a1/messages',
      expect.objectContaining({ method: 'POST', body: '{"to":"Corvin","message":"hi"}' }),
    );
  });

  it('passes server error codes through', async () => {
    const api = createVillageApi({
      ...OPTIONS,
      fetch: respond(409, { code: 'AGENT_OFFLINE' }),
    });
    await expect(api.sendMessage('Corvin', 'hi')).resolves.toEqual({
      ok: false,
      code: 'AGENT_OFFLINE',
    });
  });

  it('maps unknown error bodies to INVALID_MESSAGE', async () => {
    const api = createVillageApi({
      ...OPTIONS,
      fetch: respond(500, undefined),
    });
    await expect(api.listVillagers()).resolves.toEqual({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it('reports an unreachable server', async () => {
    const api = createVillageApi({
      ...OPTIONS,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    await expect(api.listVillagers()).resolves.toEqual({ ok: false, code: 'UNREACHABLE' });
  });
});

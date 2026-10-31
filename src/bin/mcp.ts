import { createRequire } from 'node:module';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ENV_PREFIX } from '../shared/constants.js';
import { createVillageApi, createVillageServer } from '../server/mcp/village-tools.js';

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };
const port = Number(process.env[`${ENV_PREFIX}PORT`]);
const agentId = process.env[`${ENV_PREFIX}AGENT_ID`] ?? '';
const token = process.env[`${ENV_PREFIX}TOKEN`] ?? '';
const name = process.env[`${ENV_PREFIX}AGENT_NAME`];

if (!Number.isInteger(port) || agentId === '' || token === '') {
  process.stderr.write('guildcraft mcp: missing port, agent id or token in the environment\n');
  process.exit(1);
}

const server = createVillageServer(
  createVillageApi({ port, agentId, token, fetch }),
  version,
  name,
);
await server.connect(new StdioServerTransport());

import type { Failure } from '../../shared/errors.js';
import type { ClientMessage } from '../../shared/protocol.js';
import type { AgentManager, ManagerResult } from '../agents/agent-manager.js';

export type CommandTarget = Pick<
  AgentManager,
  | 'input'
  | 'resize'
  | 'create'
  | 'remove'
  | 'removeAll'
  | 'restart'
  | 'interrupt'
  | 'setSkin'
  | 'sendPrompt'
  | 'decidePermission'
>;

function codeOf(result: ManagerResult<unknown>): Failure | null {
  if (result.ok) return null;
  return result.params ? { code: result.code, params: result.params } : { code: result.code };
}

export async function handleClientMessage(
  manager: CommandTarget,
  message: ClientMessage,
): Promise<Failure | null> {
  switch (message.type) {
    case 'term:input':
      return codeOf(manager.input(message.agentId, message.data));
    case 'term:resize':
      return codeOf(manager.resize(message.agentId, message.cols, message.rows));
    case 'agent:create':
      return codeOf(
        await manager.create({
          name: message.name,
          cwd: message.cwd,
          skin: message.skin,
          permissionMode: message.permissionMode,
        }),
      );
    case 'agent:remove':
      return codeOf(await manager.remove(message.agentId));
    case 'agent:removeAll':
      await manager.removeAll();
      return null;
    case 'agent:restart':
      return codeOf(await manager.restart(message.agentId));
    case 'agent:interrupt':
      return codeOf(manager.interrupt(message.agentId));
    case 'agent:setSkin':
      return codeOf(await manager.setSkin(message.agentId, message.skin));
    case 'prompt:send':
      return codeOf(manager.sendPrompt(message.agentIds, message.text));
    case 'permission:decide':
      return codeOf(manager.decidePermission(message.requestId, message.decision));
  }
}

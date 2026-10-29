import { Router } from 'express';
import type { AgentView } from '../../../shared/agent.js';
import type { AgentManager } from '../../agents/agent-manager.js';
import { sendError } from '../respond.js';

export type VillagerTarget = Pick<AgentManager, 'others' | 'sendMessage'>;

export interface Villager {
  name: string;
  cwd: string;
  status: AgentView['status'];
  doing: string | null;
  queued: number;
}

export function toVillager(view: AgentView): Villager {
  return {
    name: view.name,
    cwd: view.cwd,
    status: view.status,
    doing: view.tool ? `${view.tool.name}: ${view.tool.detail}` : null,
    queued: view.queued,
  };
}

function field(body: unknown, key: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : null;
}

export function villagersRouter(manager: VillagerTarget): Router {
  const router = Router();
  router.get('/api/:id/villagers', (req, res) => {
    const result = manager.others(req.params.id);
    if (result.ok) res.json(result.value.map(toVillager));
    else sendError(res, result.code);
  });
  router.post('/api/:id/messages', (req, res) => {
    const to = field(req.body, 'to');
    const message = field(req.body, 'message');
    if (typeof to !== 'string' || typeof message !== 'string') {
      sendError(res, 'INVALID_MESSAGE');
      return;
    }
    const result = manager.sendMessage(req.params.id, to, message);
    if (result.ok) res.json(result.value);
    else sendError(res, result.code);
  });
  return router;
}

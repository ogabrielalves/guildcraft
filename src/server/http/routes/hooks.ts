import { Router } from 'express';
import type { AgentManager } from '../../agents/agent-manager.js';
import { isHookEvent } from '../../hooks/hook-events.js';
import { sendError } from '../respond.js';

export type HookTarget = Pick<AgentManager, 'hook'>;

export function hooksRouter(manager: HookTarget): Router {
  const router = Router();
  router.post('/hook/:id/:event', (req, res) => {
    const { id, event } = req.params;
    if (!isHookEvent(event)) {
      sendError(res, 'INVALID_MESSAGE');
      return;
    }
    const result = manager.hook(id, event, req.body);
    if (result.ok) res.status(204).end();
    else sendError(res, result.code);
  });
  return router;
}

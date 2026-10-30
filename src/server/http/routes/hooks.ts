import { Router } from 'express';
import type { AgentManager } from '../../agents/agent-manager.js';
import { isHookEvent } from '../../hooks/hook-events.js';
import { MAX_WAIT_MS } from '../../permissions/permission-broker.js';
import { sendError } from '../respond.js';

export type HookTarget = Pick<AgentManager, 'hook' | 'openPermission' | 'waitPermission'>;

export function waitTimeout(raw: unknown): number {
  const seconds = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return MAX_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.round(seconds * 1_000));
}

export function hooksRouter(manager: HookTarget): Router {
  const router = Router();
  router.post('/hook/:id/permission', (req, res) => {
    const result = manager.openPermission(req.params.id, req.body);
    if (!result.ok) {
      sendError(res, result.code);
      return;
    }
    const opened = result.value;
    if (opened.ok) res.status(201).json({ id: opened.id, expiresAt: opened.expiresAt });
    else res.status(200).json({ skip: 'skip' in opened ? opened.skip : 'unsupported' });
  });
  router.get('/hook/:id/permission/:requestId', (req, res) => {
    const waiting = manager.waitPermission(
      req.params.id,
      req.params.requestId,
      waitTimeout(req.query.timeout),
    );
    if (!waiting) {
      sendError(res, 'PERMISSION_NOT_FOUND');
      return;
    }
    void waiting.then((result) => {
      if (!res.writableEnded) res.json(result);
    });
  });
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

import { stat } from 'node:fs/promises';
import { Router } from 'express';
import { MAX_PATH_LENGTH } from '../../../shared/constants.js';
import { pickFolder } from '../../platform/folder-dialog.js';
import { sendError } from '../respond.js';

export interface FsDeps {
  pickFolder: (initial: string | null) => Promise<string | null>;
  isDirectory: (path: string) => Promise<boolean>;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export function defaultFsDeps(): FsDeps {
  return {
    pickFolder: (initial) => pickFolder(process.platform, initial),
    isDirectory,
  };
}

export function fsRouter(deps: FsDeps): Router {
  const router = Router();
  let inflight: Promise<string | null> | null = null;
  router.post('/api/fs/pick', async (req, res) => {
    const raw = (req.body as { path?: unknown } | undefined)?.path;
    const initial =
      typeof raw === 'string' && raw.length <= MAX_PATH_LENGTH && (await deps.isDirectory(raw))
        ? raw
        : null;
    inflight ??= deps.pickFolder(initial).finally(() => {
      inflight = null;
    });
    try {
      const path = await inflight;
      res.json({ path: path !== null && (await deps.isDirectory(path)) ? path : null });
    } catch {
      sendError(res, 'SPAWN_FAILED');
    }
  });
  return router;
}

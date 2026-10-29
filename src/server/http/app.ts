import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { TOKEN_HEADER } from '../../shared/constants.js';
import { tokensMatch } from '../security.js';
import { sendError } from './respond.js';
import type { FsDeps } from './routes/fs.js';
import { fsRouter } from './routes/fs.js';
import type { HookTarget } from './routes/hooks.js';
import { hooksRouter } from './routes/hooks.js';
import type { VillagerTarget } from './routes/villagers.js';
import { villagersRouter } from './routes/villagers.js';

export const BODY_LIMIT = '1mb';

export interface AppOptions {
  manager: HookTarget & VillagerTarget;
  token: string;
  fs: FsDeps;
  webDir: string | null;
  assetsDir: string;
}

export function requireToken(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (tokensMatch(token, req.get(TOKEN_HEADER))) next();
    else sendError(res, 'UNAUTHORIZED');
  };
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use('/assets', express.static(options.assetsDir, { fallthrough: false }));
  if (options.webDir) app.use(express.static(options.webDir));

  app.use(['/hook', '/api'], requireToken(options.token), express.json({ limit: BODY_LIMIT }));
  app.use(hooksRouter(options.manager));
  app.use(villagersRouter(options.manager));
  app.use(fsRouter(options.fs));

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const status = (error as { status?: number }).status;
    res.status(typeof status === 'number' && status < 500 ? status : 500).end();
  });
  return app;
}

import type { Express, NextFunction, Request, Response } from 'express';
import type { Orchestrator } from './orchestrator.js';
import type { PersistencePort } from './persist.js';
import {
  ADMIN_MUTATION_BUCKET,
  TokenBucketLimiter,
  type NowMsFn,
} from './rate-limit.js';

export type MountAdminRoutesOptions = {
  /** Required secret; when missing/empty, all admin routes return 401. */
  readonly adminToken?: string | null;
  readonly nowMs?: NowMsFn;
};

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const alt = req.header('x-admin-token');
  return alt?.trim() || null;
}

function clientKey(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * EC-R01 — minimal admin visibility for currently frozen rooms.
 * Authenticated via `ADMIN_API_TOKEN` (Bearer or X-Admin-Token).
 */
export function mountAdminRoutes(
  app: Express,
  orch: Orchestrator,
  persist: PersistencePort,
  opts: MountAdminRoutesOptions = {},
): void {
  const configured =
    opts.adminToken ?? process.env['ADMIN_API_TOKEN'] ?? null;
  const mutationLimiter = new TokenBucketLimiter(
    ADMIN_MUTATION_BUCKET,
    opts.nowMs ?? (() => Date.now()),
  );

  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!configured) {
      res.status(401).json({ ok: false, reason: 'Admin API is not configured' });
      return;
    }
    const presented = extractBearerToken(req);
    if (!presented || presented !== configured) {
      res.status(401).json({ ok: false, reason: 'Unauthorized' });
      return;
    }
    next();
  };

  const rateLimitMutations = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    if (!mutationLimiter.tryTake(clientKey(req))) {
      res.status(429).json({ ok: false, reason: 'Too many requests' });
      return;
    }
    next();
  };

  app.get('/admin/frozen-rooms', requireAdmin, async (_req: Request, res: Response) => {
    const fromMemory = orch.listFrozen();
    let fromDb: typeof fromMemory = [];
    if (persist.isAvailable()) {
      try {
        fromDb = [...(await persist.listFrozenRooms())];
      } catch {
        fromDb = [];
      }
    }
    const byId = new Map<string, (typeof fromMemory)[number]>();
    for (const row of [...fromDb, ...fromMemory]) {
      byId.set(row.roomId, row);
    }
    res.json({
      frozenRooms: [...byId.values()],
      incidents: orch.incidents.list(),
    });
  });

  app.post(
    '/admin/rooms/:roomId/resume',
    requireAdmin,
    rateLimitMutations,
    async (req: Request, res: Response) => {
      const roomId = req.params['roomId'];
      if (!roomId) {
        res.status(400).json({ ok: false, reason: 'Missing roomId' });
        return;
      }
      const result = await orch.resumeFrozen(roomId);
      if (!result.ok) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    },
  );
}

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createAuth, type AuthConfig } from './auth.js';
import { Bureau, BureauError, errorStatus } from './bureau.js';
import type { IntegrationInput, Integrations } from './integrations.js';

function integrationId(id: string): 'ghost' | 'buffer' {
  if (id !== 'ghost' && id !== 'buffer') throw new BureauError(`Unknown integration ${id}`, 404);
  return id;
}

function body<T>(value: unknown, check: (v: Record<string, unknown>) => T): T {
  if (!value || typeof value !== 'object') throw new BureauError('Expected a JSON object');
  return check(value as Record<string, unknown>);
}

/**
 * The JSON API the web UI talks to. Every route is a thin call into Bureau,
 * and every route but health and sign-in needs a session when `auth` is set.
 */
export function createApi(
  bureau: Bureau,
  auth: AuthConfig | null,
  integrations?: Integrations,
): Hono {
  const api = new Hono();
  const guard = createAuth(auth);

  api.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const status = errorStatus(error);
    return c.json({ error: error.message }, status as 400);
  });

  // Better Auth checks the origin of its own routes; these guard Bureau's.
  api.on(['GET', 'POST'], '/auth/*', guard.handler);
  api.use('*', guard.sameOrigin, guard.requireSession);

  api.get('/health', (c) => c.json({ ok: true }));

  api.get('/session', guard.session);

  api.get('/overview', async (c) => c.json(await bureau.overview()));

  api.put('/items/:id/schedule', async (c) => {
    const input = body(await c.req.json().catch(() => null), (v) => {
      if (v.scheduledAt !== null && typeof v.scheduledAt !== 'string') {
        throw new BureauError('scheduledAt must be an ISO date string or null');
      }
      return { scheduledAt: v.scheduledAt as string | null, cascade: v.cascade === true };
    });
    const result = await bureau.reschedule(c.req.param('id'), input.scheduledAt, {
      cascade: input.cascade,
    });
    return c.json(result);
  });

  api.post('/relationships', async (c) => {
    const input = body(await c.req.json().catch(() => null), (v) => {
      if (!Array.isArray(v.itemIds) || !v.itemIds.every((id) => typeof id === 'string')) {
        throw new BureauError('itemIds must be an array of item ids');
      }
      return {
        itemIds: v.itemIds as string[],
        reason: typeof v.reason === 'string' ? v.reason : undefined,
      };
    });
    return c.json(await bureau.link(input.itemIds, input.reason), 201);
  });

  api.delete('/relationships/:id', async (c) => {
    await bureau.unlink(c.req.param('id'));
    return c.body(null, 204);
  });

  api.put('/channels/:id/followers', async (c) => {
    const input = body(await c.req.json().catch(() => null), (v) => {
      if (v.followers !== null && typeof v.followers !== 'number') {
        throw new BureauError('followers must be a number or null');
      }
      return v.followers as number | null;
    });
    await bureau.setFollowers(c.req.param('id'), input);
    return c.body(null, 204);
  });

  api.get('/analytics', async (c) => {
    const options: { from?: string; to?: string; refresh?: boolean } = {};
    const from = c.req.query('from');
    const to = c.req.query('to');
    if (from) options.from = from;
    if (to) options.to = to;
    if (c.req.query('refresh') === '1') options.refresh = true;
    return c.json(await bureau.analytics(options));
  });

  api.get('/analytics/history', async (c) => c.json(await bureau.history()));

  api.get('/changes', async (c) => c.json(await bureau.recentChanges()));

  // Settings: connecting Ghost and Buffer from the app. Keys go in, never out.
  if (integrations) {
    const input = async (c: Context): Promise<IntegrationInput> => {
      const id = integrationId(c.req.param('id') ?? '');
      return body(await c.req.json().catch(() => null), (v) => ({ ...v, id }) as IntegrationInput);
    };

    api.get('/settings/integrations', async (c) => c.json(await integrations.status()));

    api.put('/settings/integrations/:id', async (c) => {
      return c.json(await integrations.save(await input(c)));
    });

    api.delete('/settings/integrations/:id', async (c) => {
      return c.json(await integrations.clear(integrationId(c.req.param('id'))));
    });

    api.post('/settings/integrations/:id/test', async (c) => {
      return c.json(await integrations.test(await input(c)));
    });
  }

  return api;
}

/** `auth` is required on purpose: running without a login has to be a decision. */
export function createApp(
  bureau: Bureau,
  auth: AuthConfig | null,
  integrations?: Integrations,
): Hono {
  const app = new Hono();
  app.route('/api', createApi(bureau, auth, integrations));
  return app;
}

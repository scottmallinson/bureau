import { Hono } from 'hono';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createBureau } from './setup.js';

/** Answers every request with 503 and leaves the reason in the function logs. */
function unavailable(reason: string): Hono {
  console.error(`Bureau is not serving requests: ${reason}`);
  const app = new Hono();
  app.all('*', (c) =>
    c.json({ error: 'Bureau is not configured yet. The deployment logs say why.' }, 503),
  );
  return app;
}

/**
 * The app as a Vercel Function serves it (see `api/index.js`). A deployment
 * is public, so where the Node server refuses to listen beyond loopback
 * without a login, this refuses to answer at all.
 */
export function createVercelApp(env: NodeJS.ProcessEnv = process.env): Hono {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    return unavailable((error as Error).message);
  }
  if (!config.auth) {
    return unavailable('no sign-in provider is configured, and a deployment is public');
  }
  return createApp(createBureau(config), config.auth);
}

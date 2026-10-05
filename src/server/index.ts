import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createBureau } from './setup.js';

const config = loadConfig();
const bureau = createBureau(config);
const app = createApp(bureau);

// In production the built UI is served from the same origin as the API. In
// development Vite serves it and proxies /api here.
const webRoot = resolve('dist/web');
if (existsSync(webRoot)) {
  const root = relative(process.cwd(), webRoot);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  const modes = [
    `Ghost: ${config.ghost ? 'live' : 'mock'}`,
    `Buffer: ${config.buffer ? 'live' : 'mock'}`,
  ].join(', ');
  console.log(`Bureau listening on http://${config.host}:${info.port} (${modes})`);
});

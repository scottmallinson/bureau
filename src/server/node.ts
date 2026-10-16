import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { createApp } from './app.js';
import type { Config } from './config.js';
import type { SecretBox } from './integrations.js';
import { createServices } from './setup.js';

export interface ServeOptions {
  /** The built UI to serve next to the API, when it exists. */
  webRoot?: string;
  secrets?: SecretBox;
  /**
   * Answer only requests addressed to this server by its loopback address, so
   * a web page cannot reach it by pointing its own domain at 127.0.0.1 (DNS
   * rebinding). The desktop app turns this on; `npm run dev` cannot, because
   * Vite's proxy forwards its own Host header.
   */
  loopbackHostOnly?: boolean;
}

/** Starts Bureau's HTTP server and resolves once it is listening. */
export function serveBureau(
  config: Config,
  options: ServeOptions = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  const { bureau, integrations } = createServices(
    config,
    options.secrets ? { secrets: options.secrets } : {},
  );
  const app = new Hono();
  let port = config.port;

  if (options.loopbackHostOnly) {
    app.use('*', async (c, next) => {
      const host = c.req.header('host');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
        return c.text('Unknown host', 421);
      }
      await next();
    });
  }

  app.route('/', createApp(bureau, config.auth ?? null, integrations));

  // In production the built UI is served from the same origin as the API. In
  // development Vite serves it and proxies /api here.
  if (options.webRoot && existsSync(options.webRoot)) {
    app.use('/*', serveStatic({ root: options.webRoot }));
    app.get('*', serveStatic({ root: options.webRoot, path: 'index.html' }));
  }

  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
    server.once('error', reject);
  });
}

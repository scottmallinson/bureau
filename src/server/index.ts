import { resolve } from 'node:path';
import { isLoopback, loadConfig } from './config.js';
import { serveBureau } from './node.js';

const config = loadConfig();

// Bureau can move scheduled posts, so it never listens beyond this machine
// without a login.
if (!config.auth && !isLoopback(config.host)) {
  console.error(
    `Refusing to listen on ${config.host} without a login. Configure a sign-in provider (see README), or leave HOST unset.`,
  );
  process.exit(1);
}

const { port } = await serveBureau(config, { webRoot: resolve('dist/web') });
console.log(
  `Bureau listening on http://${config.host}:${port} (login: ${config.auth ? 'on' : 'off'})`,
);

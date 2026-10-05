// Runs the API (with reload) and the Vite dev server side by side.
import { spawn } from 'node:child_process';

const children = ['dev:server', 'dev:web'].map((script) =>
  spawn('npm', ['run', '--silent', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && stop());

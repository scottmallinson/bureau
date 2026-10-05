import { createHmac } from 'node:crypto';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mint a Ghost Admin API token from an Admin API key (`id:secret`), as issued
 * by a custom integration in Ghost Admin.
 *
 * Ghost signs these HS256 with the secret decoded from hex, keys them by the
 * token id in the "kid" header, and rejects anything older than five minutes or
 * aimed at the wrong audience. The audience is matched against the request path,
 * so "/admin/" is what every Admin API call wants.
 *
 * Hand-rolled rather than pulled from jsonwebtoken: it is fifteen lines, and a
 * personal app that handles an admin credential is better off with a dependency
 * tree it can read in full.
 */
export function createAdminToken(
  id: string,
  secret: string,
  options: { now?: number; audience?: string; ttlSeconds?: number } = {},
): string {
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? 300;

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id }));
  const payload = base64url(
    JSON.stringify({
      iat: now,
      exp: now + ttl,
      aud: options.audience ?? '/admin/',
    }),
  );

  const signature = base64url(
    createHmac('sha256', Buffer.from(secret, 'hex')).update(`${header}.${payload}`).digest(),
  );

  return `${header}.${payload}.${signature}`;
}

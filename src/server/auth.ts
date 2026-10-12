import { createHash, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sign, verify } from 'hono/jwt';

export interface AuthConfig {
  /** The owner's password. Bureau has one user. */
  password: string;
  /** Signs session cookies. Rotating it signs everyone out. */
  sessionSecret: string;
  /** How long a sign-in lasts. */
  sessionDays: number;
}

export const SESSION_COOKIE = 'bureau_session';

/** Failed sign-ins allowed per window, across all clients, before Bureau stops checking. */
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

/** Paths under /api that answer without a session. */
const PUBLIC_PATHS = new Set(['/health', '/session', '/login', '/logout']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Compares in constant time, whatever the lengths. */
export function passwordMatches(candidate: string, password: string): boolean {
  return timingSafeEqual(digest(candidate), digest(password));
}

/**
 * Cookies are `Secure` everywhere except plain HTTP on loopback, so `npm run
 * dev` still works in browsers that refuse Secure cookies on localhost.
 */
function isSecure(c: Context): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https') return true;
  return !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * Single-owner sign-in for the JSON API.
 *
 * A session is an HS256 JWT in an HttpOnly, SameSite=Strict cookie, so nothing
 * is stored server-side and it works the same on one Node process or many
 * serverless instances. The UI and its assets stay public: they hold no data,
 * and every call they make for some goes through `requireSession`.
 *
 * `auth` is null only when the server has decided running open is safe (see
 * `src/server/index.ts`); then every route answers and `/session` says so.
 */
export function createAuth(auth: AuthConfig | null, now: () => number = Date.now) {
  const failures: number[] = [];

  async function signedIn(c: Context): Promise<boolean> {
    if (!auth) return true;
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) return false;
    try {
      const payload = await verify(token, auth.sessionSecret, 'HS256');
      return payload.sub === 'owner';
    } catch {
      return false;
    }
  }

  /** Rejects state-changing requests a browser marks as coming from another site. */
  const sameOrigin: MiddlewareHandler = async (c, next) => {
    const site = c.req.header('sec-fetch-site');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
    if (unsafe && site && site !== 'same-origin' && site !== 'none') {
      return c.json({ error: 'Cross-site request refused' }, 403);
    }
    await next();
  };

  const requireSession: MiddlewareHandler = async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path.replace(/^\/api/, '')) || (await signedIn(c))) {
      await next();
      return;
    }
    return c.json({ error: 'Sign in to continue' }, 401);
  };

  async function session(c: Context) {
    return c.json({ required: auth !== null, authenticated: await signedIn(c) });
  }

  async function login(c: Context) {
    if (!auth) return c.body(null, 204);

    const cutoff = now() - FAILURE_WINDOW_MS;
    while (failures.length && failures[0]! < cutoff) failures.shift();
    if (failures.length >= MAX_FAILURES) {
      const retryAfter = Math.ceil((failures[0]! + FAILURE_WINDOW_MS - now()) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many failed sign-ins. Try again later.' }, 429);
    }

    const input = (await c.req.json().catch(() => null)) as { password?: unknown } | null;
    const password = typeof input?.password === 'string' ? input.password : '';
    if (!passwordMatches(password, auth.password)) {
      failures.push(now());
      return c.json({ error: 'Wrong password' }, 401);
    }

    const issuedAt = Math.floor(now() / 1000);
    const maxAge = auth.sessionDays * 86_400;
    const token = await sign(
      { sub: 'owner', iat: issuedAt, exp: issuedAt + maxAge },
      auth.sessionSecret,
      'HS256',
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isSecure(c),
      sameSite: 'Strict',
      path: '/',
      maxAge,
    });
    return c.body(null, 204);
  }

  function logout(c: Context) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecure(c) });
    return c.body(null, 204);
  }

  return { sameOrigin, requireSession, session, login, logout };
}

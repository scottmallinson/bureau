import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { SESSION_COOKIE, type AuthConfig } from '../src/server/auth.js';
import { loadConfig } from '../src/server/config.js';
import { demoBureau } from './helpers.js';

const AUTH: AuthConfig = {
  password: 'correct horse battery staple',
  sessionSecret: 'a'.repeat(32),
  sessionDays: 30,
};

async function app(auth: AuthConfig | null = AUTH) {
  return createApp(await demoBureau(), auth);
}

const BASE = 'https://bureau.example.com';

function login(password: string) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  };
}

/** The `name=value` part of the session cookie a response sets. */
function sessionCookie(res: Response): string {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(new RegExp(`${SESSION_COOKIE}=[^;]+`));
  if (!match) throw new Error(`No session cookie in: ${header}`);
  return match[0];
}

describe('sign-in', () => {
  it('turns away every data route without a session', async () => {
    const server = await app();
    for (const [method, path] of [
      ['GET', '/api/overview'],
      ['GET', '/api/analytics'],
      ['GET', '/api/changes'],
      ['PUT', '/api/items/ghost%3A1/schedule'],
      ['POST', '/api/relationships'],
      ['DELETE', '/api/relationships/x'],
      ['PUT', '/api/channels/x/followers'],
    ] as const) {
      const res = await server.request(`${BASE}${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('leaves health and the session check public', async () => {
    const server = await app();
    expect((await server.request(`${BASE}/api/health`)).status).toBe(200);
    const res = await server.request(`${BASE}/api/session`);
    expect(await res.json()).toEqual({ required: true, authenticated: false });
  });

  it('rejects a wrong password', async () => {
    const res = await (await app()).request(`${BASE}/api/login`, login('nope'));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('signs in with the password, and the cookie opens the API', async () => {
    const server = await app();
    const res = await server.request(`${BASE}/api/login`, login(AUTH.password));
    expect(res.status).toBe(204);

    const header = res.headers.get('set-cookie')!;
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Strict/);

    const cookie = sessionCookie(res);
    const overview = await server.request(`${BASE}/api/overview`, { headers: { Cookie: cookie } });
    expect(overview.status).toBe(200);
    const session = await server.request(`${BASE}/api/session`, { headers: { Cookie: cookie } });
    expect(await session.json()).toEqual({ required: true, authenticated: true });
  });

  it('refuses a cookie signed with another secret', async () => {
    const other = await app({ ...AUTH, sessionSecret: 'b'.repeat(32) });
    const cookie = sessionCookie(await other.request(`${BASE}/api/login`, login(AUTH.password)));
    const res = await (
      await app()
    ).request(`${BASE}/api/overview`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(401);
  });

  it('clears the cookie on sign-out', async () => {
    const res = await (await app()).request(`${BASE}/api/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));
  });

  it('stops checking passwords after repeated failures', async () => {
    const server = await app();
    for (let i = 0; i < 10; i++) {
      expect((await server.request(`${BASE}/api/login`, login('guess'))).status).toBe(401);
    }
    const locked = await server.request(`${BASE}/api/login`, login(AUTH.password));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('refuses cross-site writes even with a session', async () => {
    const server = await app();
    const cookie = sessionCookie(await server.request(`${BASE}/api/login`, login(AUTH.password)));
    const res = await server.request(`${BASE}/api/relationships`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ itemIds: ['a', 'b'] }),
    });
    expect(res.status).toBe(403);
  });

  it('reports no login when the server runs open', async () => {
    const server = await app(null);
    expect((await server.request('/api/overview')).status).toBe(200);
    const res = await server.request('/api/session');
    expect(await res.json()).toEqual({ required: false, authenticated: true });
  });
});

describe('auth configuration', () => {
  it('is off without a password', () => {
    expect(loadConfig({}).auth).toBeUndefined();
  });

  it('reads the password, secret and session length', () => {
    const config = loadConfig({
      BUREAU_PASSWORD: AUTH.password,
      BUREAU_SESSION_SECRET: AUTH.sessionSecret,
      BUREAU_SESSION_DAYS: '7',
    });
    expect(config.auth).toEqual({ ...AUTH, sessionDays: 7 });
  });

  it('refuses a short password or a missing secret', () => {
    expect(() =>
      loadConfig({ BUREAU_PASSWORD: 'short', BUREAU_SESSION_SECRET: AUTH.sessionSecret }),
    ).toThrow(/BUREAU_PASSWORD/);
    expect(() => loadConfig({ BUREAU_PASSWORD: AUTH.password })).toThrow(/BUREAU_SESSION_SECRET/);
  });
});

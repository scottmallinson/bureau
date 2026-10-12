import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { isAllowed, type AuthConfig } from '../src/server/auth.js';
import { loadConfig } from '../src/server/config.js';
import { demoBureau } from './helpers.js';

const BASE = 'https://bureau.example.com';
const OWNER = 'owner@example.com';

const AUTH: AuthConfig = {
  secret: 'a-test-secret-that-is-long-enough-to-pass',
  baseURL: BASE,
  allowedEmails: [OWNER],
  providers: { github: { clientId: 'id', clientSecret: 'secret' } },
  sessionDays: 7,
};

async function app(auth: AuthConfig | null = AUTH) {
  return createApp(await demoBureau(), auth);
}

/** Cookies set so far, sent back as a browser would. */
class Jar {
  private cookies = new Map<string, string>();

  take(res: Response): this {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...value] = pair!.split('=');
      if (/max-age=0/i.test(header)) this.cookies.delete(name!);
      else this.cookies.set(name!, value.join('='));
    }
    return this;
  }

  get header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** Stands in for GitHub's token and user endpoints. */
function fakeGitHub(email: string, verified = true) {
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const reply = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return reply({ access_token: 'token', token_type: 'bearer', scope: 'read:user,user:email' });
    }
    if (url === 'https://api.github.com/user') {
      return reply({ id: 42, login: 'owner', name: 'Owner', email, avatar_url: '' });
    }
    if (url === 'https://api.github.com/user/emails') {
      return reply([{ email, primary: true, verified }]);
    }
    return real(input, init);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs the whole GitHub sign-in through the API and returns the browser's cookies. */
async function signIn(server: Awaited<ReturnType<typeof app>>) {
  const jar = new Jar();
  const start = await server.request(`${BASE}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
  });
  expect(start.status).toBe(200);
  jar.take(start);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  expect(new URL(url).host).toBe('github.com');

  const callback = await server.request(
    `${BASE}/api/auth/callback/github?code=code&state=${encodeURIComponent(state)}`,
    { headers: { Cookie: jar.header } },
  );
  jar.take(callback);
  return { jar, callback };
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

  it('leaves health and the session check public, and lists the providers', async () => {
    const server = await app();
    expect((await server.request(`${BASE}/api/health`)).status).toBe(200);
    const res = await server.request(`${BASE}/api/session`);
    expect(await res.json()).toEqual({
      required: true,
      authenticated: false,
      providers: ['github'],
      user: null,
    });
  });

  it('lets the owner in through GitHub, and out again', async () => {
    fakeGitHub(OWNER);
    const server = await app();
    const { jar, callback } = await signIn(server);
    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/');

    const overview = await server.request(`${BASE}/api/overview`, {
      headers: { Cookie: jar.header },
    });
    expect(overview.status).toBe(200);
    const session = await server.request(`${BASE}/api/session`, {
      headers: { Cookie: jar.header },
    });
    expect(await session.json()).toMatchObject({ authenticated: true, user: { email: OWNER } });

    const out = await server.request(`${BASE}/api/auth/sign-out`, {
      method: 'POST',
      headers: { Cookie: jar.header, Origin: BASE },
    });
    expect(out.status).toBe(200);
    jar.take(out);
    const after = await server.request(`${BASE}/api/overview`, {
      headers: { Cookie: jar.header },
    });
    expect(after.status).toBe(401);
  });

  it('turns away anyone not on the list', async () => {
    fakeGitHub('stranger@example.com');
    const server = await app();
    const { jar, callback } = await signIn(server);
    expect(callback.headers.get('location')).toMatch(/error=not_allowed/);
    const overview = await server.request(`${BASE}/api/overview`, {
      headers: { Cookie: jar.header },
    });
    expect(overview.status).toBe(401);
  });

  it('turns away the owner address when the provider has not verified it', async () => {
    fakeGitHub(OWNER, false);
    const server = await app();
    const { jar, callback } = await signIn(server);
    expect(callback.headers.get('location')).toMatch(/error=not_allowed/);
    const res = await server.request(`${BASE}/api/overview`, { headers: { Cookie: jar.header } });
    expect(res.status).toBe(401);
  });

  it('refuses a session cookie made with another secret', async () => {
    fakeGitHub(OWNER);
    const other = await app({ ...AUTH, secret: 'another-test-secret-that-is-long-enough' });
    const { jar } = await signIn(other);
    const res = await (
      await app()
    ).request(`${BASE}/api/overview`, {
      headers: { Cookie: jar.header },
    });
    expect(res.status).toBe(401);
  });

  it('refuses cross-site writes even with a session', async () => {
    fakeGitHub(OWNER);
    const server = await app();
    const { jar } = await signIn(server);
    const res = await server.request(`${BASE}/api/relationships`, {
      method: 'POST',
      headers: { Cookie: jar.header, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ itemIds: ['a', 'b'] }),
    });
    expect(res.status).toBe(403);
  });

  it('reports no login when the server runs open', async () => {
    const server = await app(null);
    expect((await server.request('/api/overview')).status).toBe(200);
    const res = await server.request('/api/session');
    expect(await res.json()).toMatchObject({ required: false, authenticated: true });
  });
});

describe('allowlist', () => {
  it('needs a verified address on the list, whatever its case', () => {
    expect(isAllowed({ email: 'Owner@Example.com', emailVerified: true }, [OWNER])).toBe(true);
    expect(isAllowed({ email: OWNER, emailVerified: false }, [OWNER])).toBe(false);
    expect(isAllowed({ email: 'other@example.com', emailVerified: true }, [OWNER])).toBe(false);
    expect(isAllowed({ email: null, emailVerified: true }, [OWNER])).toBe(false);
  });
});

describe('auth configuration', () => {
  const env = {
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    BUREAU_ALLOWED_EMAILS: ' Owner@example.com, second@example.com ',
    BETTER_AUTH_SECRET: AUTH.secret,
  };

  it('is off without a provider', () => {
    expect(loadConfig({}).auth).toBeUndefined();
  });

  it('reads providers, the allowlist and the secret', () => {
    const config = loadConfig({
      ...env,
      MICROSOFT_CLIENT_ID: 'ms',
      MICROSOFT_CLIENT_SECRET: 'ms-secret',
      MICROSOFT_TENANT_ID: 'tenant',
      BETTER_AUTH_URL: `${BASE}/`,
    });
    expect(config.auth).toEqual({
      secret: AUTH.secret,
      baseURL: BASE,
      allowedEmails: [OWNER, 'second@example.com'],
      providers: {
        github: { clientId: 'id', clientSecret: 'secret' },
        microsoft: { clientId: 'ms', clientSecret: 'ms-secret', tenantId: 'tenant' },
      },
      sessionDays: 7,
    });
  });

  it('refuses a half-made setup', () => {
    expect(() => loadConfig({ ...env, BUREAU_ALLOWED_EMAILS: '' })).toThrow(/ALLOWED_EMAILS/);
    expect(() => loadConfig({ ...env, BETTER_AUTH_SECRET: 'short' })).toThrow(/SECRET/);
    expect(() => loadConfig({ ...env, GOOGLE_CLIENT_ID: 'only-id' })).toThrow(/GOOGLE/);
    expect(() => loadConfig({ BUREAU_ALLOWED_EMAILS: OWNER })).toThrow(/no sign-in provider/);
  });
});

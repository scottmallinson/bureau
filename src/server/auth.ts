import { betterAuth, type BetterAuthOptions } from 'better-auth';
import type { Context, MiddlewareHandler } from 'hono';

/** The sign-in providers Bureau knows how to configure. */
export const PROVIDERS = ['google', 'github', 'microsoft', 'linkedin'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
  /** Microsoft only: the Entra tenant, or `common` for any account. */
  tenantId?: string;
}

export interface AuthConfig {
  /** Encrypts and signs session cookies. Rotating it signs everyone out. */
  secret: string;
  /** Where Bureau is served, e.g. https://bureau.example.com. Callbacks are built from it. */
  baseURL?: string;
  /** Verified email addresses allowed in. Everyone else is turned away. */
  allowedEmails: string[];
  providers: Partial<Record<ProviderName, ProviderCredentials>>;
  /** How long a sign-in lasts. */
  sessionDays: number;
}

/** True when the provider vouches for the address and it is on the list. */
export function isAllowed(
  user: { email?: string | null; emailVerified?: boolean | null },
  allowedEmails: readonly string[],
): boolean {
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && user.emailVerified === true && allowedEmails.includes(email));
}

/**
 * Sign-in through Google, GitHub, Microsoft or LinkedIn, via Better Auth.
 *
 * Bureau has no database, so this runs Better Auth stateless: the session and
 * the OAuth state live in encrypted cookies, which works the same on one Node
 * process or many serverless instances. Any provider will authenticate anyone,
 * so the allowlist is what makes this single-owner.
 */
export function createBetterAuth(config: AuthConfig) {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  const { google, github, microsoft, linkedin } = config.providers;
  if (google) socialProviders.google = { ...google, prompt: 'select_account' };
  if (github) socialProviders.github = github;
  if (microsoft)
    socialProviders.microsoft = { ...microsoft, tenantId: microsoft.tenantId ?? 'common' };
  if (linkedin) socialProviders.linkedin = linkedin;

  return betterAuth({
    basePath: '/api/auth',
    secret: config.secret,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    socialProviders,
    session: { expiresIn: config.sessionDays * 86_400 },
    user: {
      validateUserInfo: ({ user }) =>
        isAllowed(user, config.allowedEmails)
          ? undefined
          : {
              error: 'not_allowed',
              errorDescription: 'This account is not allowed to use Bureau',
            },
    },
    // Failed sign-ins come back to the app, which shows the error.
    onAPIError: { errorURL: '/' },
    telemetry: { enabled: false },
  });
}

/** Paths under /api that answer without a session. */
function isPublic(path: string): boolean {
  const rest = path.replace(/^\/api/, '');
  return rest === '/health' || rest === '/session' || rest.startsWith('/auth/');
}

/**
 * The API's side of sign-in. `config` is null only when the server has decided
 * running open is safe (see `src/server/index.ts`); then every route answers
 * and `/session` says so.
 */
export function createAuth(config: AuthConfig | null) {
  const auth = config ? createBetterAuth(config) : null;
  const providers = config ? PROVIDERS.filter((p) => config.providers[p]) : [];

  async function sessionOf(c: Context) {
    if (!auth) return null;
    return auth.api.getSession({ headers: c.req.raw.headers });
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
    if (!auth || isPublic(c.req.path) || (await sessionOf(c))) {
      await next();
      return;
    }
    return c.json({ error: 'Sign in to continue' }, 401);
  };

  /** Better Auth's own routes: sign-in, OAuth callbacks, sign-out. */
  async function handler(c: Context): Promise<Response> {
    if (!auth) return c.json({ error: 'Sign-in is not configured' }, 404);
    return auth.handler(c.req.raw);
  }

  async function session(c: Context) {
    const current = await sessionOf(c);
    return c.json({
      required: auth !== null,
      authenticated: !auth || current !== null,
      providers,
      user: current ? { email: current.user.email, name: current.user.name } : null,
    });
  }

  return { sameOrigin, requireSession, handler, session };
}

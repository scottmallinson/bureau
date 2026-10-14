import { createAuthClient } from 'better-auth/client';

/** Better Auth's browser client, pointed at the API's auth routes. */
export const authClient = createAuthClient({ basePath: '/api/auth' });

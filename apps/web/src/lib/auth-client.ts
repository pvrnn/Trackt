import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, usernameClient } from 'better-auth/client/plugins';

/**
 * Same-origin in both dev (Vite proxies /api → :3001) and prod (monolith proxy),
 * so no baseURL — the client defaults to window.location.origin.
 * Only use these hooks/methods from client-rendered code paths.
 * `role` mirrors the server's additionalFields config (apps/api/src/auth.ts).
 */
export const authClient = createAuthClient({
  plugins: [
    usernameClient(),
    inferAdditionalFields({ user: { role: { type: 'string', input: false } } }),
  ],
});

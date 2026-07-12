import { eq, or } from 'drizzle-orm';
import { USER_ROLES, UserRoleSchema } from '@trackt/shared';
import { createDb } from '../index.js';
import { users } from '../schema/index.js';

/**
 * Role bootstrap (PRD §7): promote/demote an account from the shell — there is
 * deliberately no in-app path to grant roles. Usage:
 *   pnpm db:set-role <email-or-username> <user|moderator|admin>
 */

const [identifier, roleArg] = process.argv.slice(2);
if (!identifier || !roleArg) {
  console.error('Usage: pnpm db:set-role <email-or-username> <user|moderator|admin>');
  process.exit(1);
}
const parsedRole = UserRoleSchema.safeParse(roleArg);
if (!parsedRole.success) {
  console.error(`Unknown role '${roleArg}' — expected one of: ${USER_ROLES.join(', ')}`);
  process.exit(1);
}

// Same dev fallback as drizzle.config.ts — dev needs no .env (README).
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5432/trackt';

const db = createDb(databaseUrl, { max: 1 });
try {
  const updated = await db
    .update(users)
    .set({ role: parsedRole.data })
    .where(or(eq(users.email, identifier), eq(users.username, identifier.toLowerCase())))
    .returning({ email: users.email, username: users.username, role: users.role });
  if (updated.length === 0) {
    console.error(`No account matches '${identifier}' (by email or username).`);
    process.exit(1);
  }
  for (const account of updated) {
    console.log(`${account.email} (@${account.username ?? '—'}) is now ${account.role}.`);
  }
  process.exit(0);
} catch (error) {
  console.error('Role update failed:', error);
  process.exit(1);
}

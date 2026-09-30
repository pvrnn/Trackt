import { eq } from 'drizzle-orm';
import { discordLink, users, type Db } from '@trackt/db';

export interface LinkedUser {
  userId: string;
  username: string;
}

/** The Trackt account a Discord user linked, if any. */
export async function findLinkedUser(db: Db, discordUserId: string): Promise<LinkedUser | null> {
  const [row] = await db
    .select({ userId: discordLink.userId, username: users.username })
    .from(discordLink)
    .innerJoin(users, eq(users.id, discordLink.userId))
    .where(eq(discordLink.discordUserId, discordUserId));
  return row?.username ? { userId: row.userId, username: row.username } : null;
}

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lte, or } from 'drizzle-orm';
import { DISCORD_LINK_CODE_TTL_MS } from '@trackt/shared';
import { discordLink, discordLinkCode } from './schema/discord.js';
import type { Db } from './index.js';

/** Discord ⇄ Trackt account linking, shared by the bot (issues codes) and the API (redeems them). */

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface DiscordIdentity {
  discordUserId: string;
  discordUsername: string;
}

/** A fresh single-use code for `identity`; any earlier pending code of theirs stops working. */
export async function issueLinkCode(
  db: Db,
  identity: DiscordIdentity,
  now = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + DISCORD_LINK_CODE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(discordLinkCode)
      .where(eq(discordLinkCode.discordUserId, identity.discordUserId));
    await tx
      .insert(discordLinkCode)
      .values({ codeHash: hashLinkCode(code), ...identity, expiresAt });
  });
  return { code, expiresAt };
}

export async function findLinkCode(db: Db, code: string) {
  const [row] = await db
    .select()
    .from(discordLinkCode)
    .where(
      and(
        eq(discordLinkCode.codeHash, hashLinkCode(code)),
        gt(discordLinkCode.expiresAt, new Date()),
      ),
    );
  return row;
}

/**
 * Spend `code` on `userId`. The code is deleted in the same transaction that
 * writes the link, so it works once; whatever either side was linked to
 * before is replaced. Null when the code is unknown, used, or expired.
 */
export async function redeemLinkCode(db: Db, userId: string, code: string) {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .delete(discordLinkCode)
      .where(
        and(
          eq(discordLinkCode.codeHash, hashLinkCode(code)),
          gt(discordLinkCode.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!pending) return null;
    await tx
      .delete(discordLink)
      .where(
        or(eq(discordLink.userId, userId), eq(discordLink.discordUserId, pending.discordUserId)),
      );
    const [link] = await tx
      .insert(discordLink)
      .values({
        userId,
        discordUserId: pending.discordUserId,
        discordUsername: pending.discordUsername,
      })
      .returning();
    return link ?? null;
  });
}

export async function deleteExpiredLinkCodes(db: Db, now = new Date()): Promise<void> {
  await db.delete(discordLinkCode).where(lte(discordLinkCode.expiresAt, now));
}

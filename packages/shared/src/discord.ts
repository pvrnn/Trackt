import { z } from 'zod';

/** Linking a Discord account to a Trackt account through a one-time `/link` code. */

export const DISCORD_LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** 32 random bytes, base64url. */
export const DiscordLinkCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const DiscordLinkSchema = z.object({
  discordUserId: z.string(),
  discordUsername: z.string(),
  linkedAt: z.iso.datetime(),
});
export type DiscordLink = z.infer<typeof DiscordLinkSchema>;

export const DiscordLinkStatusSchema = z.object({ linked: DiscordLinkSchema.nullable() });
export type DiscordLinkStatus = z.infer<typeof DiscordLinkStatusSchema>;

export const DiscordLinkCodeQuerySchema = z.object({ code: DiscordLinkCodeSchema });

/** Who a pending code would link, shown before the user confirms. */
export const DiscordLinkCodePreviewSchema = z.object({
  discordUsername: z.string(),
  expiresAt: z.iso.datetime(),
});
export type DiscordLinkCodePreview = z.infer<typeof DiscordLinkCodePreviewSchema>;

export const LinkDiscordBodySchema = z.object({ code: DiscordLinkCodeSchema });
export type LinkDiscordBody = z.infer<typeof LinkDiscordBodySchema>;

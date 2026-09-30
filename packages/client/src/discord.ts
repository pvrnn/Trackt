import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DiscordLinkCodePreviewSchema,
  DiscordLinkStatusSchema,
  type DiscordLinkCodePreview,
  type DiscordLinkStatus,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/** Discord account linking: the redeem half of the bot's `/link` handshake. */

export const discordLinkKey = ['discord-link'] as const;

export function useDiscordLink() {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: discordLinkKey,
    enabled: isAuthed,
    queryFn: async (): Promise<DiscordLinkStatus> => {
      try {
        return DiscordLinkStatusSchema.parse(await http().get('me/discord').json());
      } catch (error) {
        throw await toError(error, 'discord link');
      }
    },
  });
}

/** Who a `/link` code belongs to; `null` once it is used up or expired. */
export function useDiscordLinkCode(code: string | undefined) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: ['discord-link-code', code],
    enabled: isAuthed && !!code,
    retry: false,
    queryFn: async (): Promise<DiscordLinkCodePreview | null> => {
      const response = await http().get('me/discord/link-code', {
        searchParams: { code: code ?? '' },
        throwHttpErrors: false,
      });
      if (response.status === 404 || response.status === 400) return null;
      if (!response.ok) throw new Error(`discord link code responded ${response.status}`);
      return DiscordLinkCodePreviewSchema.parse(await response.json());
    },
  });
}

export const discordApi = {
  link: async (code: string): Promise<DiscordLinkStatus> => {
    try {
      return DiscordLinkStatusSchema.parse(
        await http().post('me/discord/link', { json: { code } }).json(),
      );
    } catch (error) {
      throw await toError(error, 'link discord');
    }
  },
  unlink: async () => {
    try {
      await http().delete('me/discord');
    } catch (error) {
      throw await toError(error, 'unlink discord');
    }
  },
};

export function useLinkDiscord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => discordApi.link(code),
    onSuccess: (status) => queryClient.setQueryData(discordLinkKey, status),
  });
}

export function useUnlinkDiscord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => discordApi.unlink(),
    onSuccess: () => queryClient.setQueryData(discordLinkKey, { linked: null }),
  });
}

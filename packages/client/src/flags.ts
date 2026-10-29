import { useQuery } from '@tanstack/react-query';
import {
  FLAG_DEFINITIONS,
  FlagsSnapshotSchema,
  type FlagKey,
  type FlagsSnapshot,
} from '@trackt/shared';
import { http, useViewerId } from './runtime.js';

/**
 * The client half of feature gating (ADR-0011): one snapshot query per client,
 * one boolean per call site. Evaluation is server-side only — a client that
 * computed its own bucket would disagree with the API and could be edited.
 *
 * The compiled `default` is the fallback for *every* failure — pending,
 * errored, a key missing from the snapshot, or an instance young enough to have
 * no `/v1/flags` at all. A dead endpoint must never hide a shipped feature; a
 * release flag's default is `false`, so it stays hidden for the same reason.
 */

/** Keyed by viewer: a signed-out snapshot and a signed-in one can differ. */
export const flagsKey = (viewerId: string | null) => ['flags', viewerId ?? 'anonymous'] as const;

/** Resolve one key, defaulting to the compiled value when there is no answer. */
export function flagValue(snapshot: FlagsSnapshot | undefined, key: FlagKey): boolean {
  return snapshot?.flags[key] ?? FLAG_DEFINITIONS[key].default;
}

export function useFlags() {
  const viewerId = useViewerId();
  return useQuery({
    queryKey: flagsKey(viewerId),
    queryFn: async (): Promise<FlagsSnapshot> => {
      const response = await http().get('flags', { throwHttpErrors: false });
      // An instance without the endpoint predates gating: its compiled defaults
      // are the truth, and the gate that matters there is the server's absence.
      if (response.status === 404) return { flags: {} };
      if (!response.ok) throw new Error(`flags responded ${response.status}`);
      return FlagsSnapshotSchema.parse(await response.json());
    },
    // One small query per launch/navigation, not a poll: a flip is expected
    // within a navigation. Focus keeps a long-lived tab honest.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** `true` renders the feature. Pending, failed or unknown all read as the default. */
export function useFlag(key: FlagKey): boolean {
  return flagValue(useFlags().data, key);
}

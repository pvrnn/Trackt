import * as Haptics from 'expo-haptics';

/**
 * The three haptics `Mobile System.dc.html` §07 allows, and nothing else: a
 * commit, a threshold crossing, and a failure. Never on scroll or tab change.
 *
 * Every call swallows its rejection — an emulator or a phone with the Taptic
 * Engine off rejects rather than no-ops, and a check-in must never fail
 * because the phone would not buzz.
 */
function fire(run: () => Promise<void>): void {
  run().catch(() => {});
}

/** A check-in, an uncheck, or any other write the user just committed. */
export function commitHaptic(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Crossing a threshold: a swipe arming, a chip or a star taking selection. */
export function selectionHaptic(): void {
  fire(() => Haptics.selectionAsync());
}

/** A write the server rejected — paired with the message, never on its own. */
export function errorHaptic(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

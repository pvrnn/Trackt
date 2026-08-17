import * as Haptics from 'expo-haptics';

/**
 * The three haptics the design allows, and nothing else.
 *
 * `Mobile System.dc.html` §07: "Haptics are reserved for state changes the user
 * caused and cannot see confirmed elsewhere: a check-in commit (medium impact),
 * crossing a swipe threshold (selection tick), and a failed sync (error
 * notification). Never on scroll, never on tab change." Naming them by the
 * event rather than by the API's waveform is what keeps that rule enforceable —
 * a call site asks for `commit`, not for `ImpactFeedbackStyle.Medium`.
 *
 * Every call is fire-and-forget and swallows its rejection. A device with the
 * Taptic Engine disabled, an emulator, or a simulator all reject rather than
 * no-op, and a check-in must never fail because the phone would not buzz.
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

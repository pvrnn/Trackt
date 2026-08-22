import { deleteAccount } from '@trackt/client';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space } from '../theme/tokens';
import { type } from '../theme/typography';
import { Field } from './Field';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/**
 * Deleting the account (mobile plan, phase 5) — `DELETE /api/v1/me`.
 *
 * The second confirmation in the app, and legitimate for the same reason
 * `ConfirmSheet` is: there is no undo. It asks for more than that one does,
 * though. A list is one row; this takes every check-in, rating, list and
 * friendship with it, and the phone in the user's hand is already unlocked and
 * already signed in — so what the sheet has to establish is not "did you mean
 * to tap that" but "are you the account holder". That is the password field,
 * and the server verifies it rather than trusting this screen.
 *
 * What is deliberately *not* here is a "type your username to confirm" step on
 * top. Two rituals do not double the deliberation; they train people through
 * both. One thing only they can supply is the stronger check.
 */
export function DeleteAccountSheet({
  username,
  onDeleted,
  onClose,
}: {
  username: string;
  /** Called once the server has confirmed. The caller tears the session down. */
  onDeleted: () => void;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await deleteAccount(password);
      // No `sheet.dismiss()`: the account is gone, every session with it, and
      // the caller is about to replace this whole tree with the login screen.
      // Playing an exit animation on the way out is 220ms of a screen that is
      // still fetching a profile that no longer exists.
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That didn’t work — try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet title="Delete account" subtitle={`@${username}`} controller={sheet}>
      <Text style={[type.body, styles.body]}>
        This deletes your account on this instance and everything on it — your logs, check-ins,
        ratings, favourites, lists and friendships. It cannot be undone, and nothing here is kept
        after it.
      </Text>
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      {error ? <SheetError message={error} /> : null}
      <View style={styles.actions}>
        <PrismButton
          label="Cancel"
          variant="secondary"
          disabled={busy}
          onPress={sheet.dismiss}
          style={styles.action}
        />
        <PrismButton
          label="Delete account"
          busy={busy}
          onPress={() => void submit()}
          style={styles.action}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    color: color.muted,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
  },
  action: {
    flex: 1,
  },
});

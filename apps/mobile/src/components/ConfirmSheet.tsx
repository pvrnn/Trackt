import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, space } from '../theme/tokens';
import { type } from '../theme/typography';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/**
 * The confirmation for a write that cannot be undone — deleting a list, and
 * nothing else so far.
 *
 * `Mobile System.dc.html` §04 bans the confirmation dialog for check-ins
 * specifically, because their undo is one tap. That reasoning is what makes
 * this one legitimate: a deleted list has no undo, so the question is asked
 * once, here, rather than being asked everywhere out of habit.
 */
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  /** Awaited: a rejected delete stays in the sheet with the server's reason. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      await onConfirm();
      sheet.dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That didn’t work — try again.');
      setBusy(false);
    }
  };

  return (
    <Sheet title={title} controller={sheet}>
      <Text style={[type.body, styles.body]}>{body}</Text>
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
          label={confirmLabel}
          busy={busy}
          onPress={() => void confirm()}
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

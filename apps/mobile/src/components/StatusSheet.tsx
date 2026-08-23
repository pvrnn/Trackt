import { LOG_STATUS_LABELS } from '@trackt/client';
import { LOG_STATUSES, type LogStatus } from '@trackt/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';
import { Sheet, useSheetController } from './Sheet';

/**
 * The log status picker (`PUT|DELETE /media/:id/log`).
 *
 * Web's is a `Select` pill whose empty option doubles as "＋ LOG"; a phone gets
 * the five statuses as full-width rows, because a native picker wheel hides
 * four of the five options behind a scroll and this is a five-item choice.
 * Clearing the log is the last row rather than a blank first option — it is a
 * destructive-ish action and reads wrong at the top of a list of states.
 */
export function StatusSheet({
  current,
  mediaTitle,
  onPick,
  onClose,
}: {
  current: LogStatus | null;
  mediaTitle: string;
  /** `null` clears the log entirely. */
  onPick: (status: LogStatus | null) => void;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const choose = (status: LogStatus | null) => {
    onPick(status);
    sheet.dismiss();
  };

  return (
    <Sheet title="Status" subtitle={mediaTitle} controller={sheet}>
      <View style={styles.rows}>
        {LOG_STATUSES.map((status) => (
          <Row
            key={status}
            label={LOG_STATUS_LABELS[status]}
            selected={current === status}
            onPress={() => choose(status)}
          />
        ))}
        {current !== null ? (
          <Row label="Remove from library" destructive onPress={() => choose(null)} />
        ) : null}
      </View>
    </Sheet>
  );
}

function Row({
  label,
  selected = false,
  destructive = false,
  onPress,
}: {
  label: string;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text
        style={[
          type.button,
          selected ? styles.selectedText : destructive ? styles.destructiveText : styles.text,
        ]}
      >
        {label.toUpperCase()}
      </Text>
      {selected ? <Icon name="check" color={color.pink} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space.lg,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  text: {
    color: color.fg,
  },
  selectedText: {
    color: color.pink,
  },
  destructiveText: {
    color: color.dim,
  },
});

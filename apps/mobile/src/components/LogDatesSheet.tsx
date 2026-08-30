import DateTimePicker from '@react-native-community/datetimepicker';
import { shortDate, todayIso, validateLogDates } from '@trackt/client';
import { LOG_DATE_FLOOR, type LogDates } from '@trackt/shared';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateToIso, isoToDate } from '../lib/dates';
import { color, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/**
 * Log dates (ADR-0007, `PATCH /media/:id/log`) — the one form in the app that
 * genuinely improves on web.
 *
 * Status changes and check-ins stamp these server-side; this is the correction,
 * and the only way to record when you actually watched something you are
 * logging after the fact. Web asks for two `YYYY-MM-DD` strings; here each date
 * is the platform's own picker, bounded to `[LOG_DATE_FLOOR, today]` so the
 * two errors a typed field invites cannot be expressed at all.
 *
 * The third error still can: a finish date before a start date. That check —
 * and the bounds, which iOS honours but Android's dialog only clamps — is
 * `@trackt/client`'s `validateLogDates`, the same function web calls.
 */
export function LogDatesSheet({
  dates,
  mediaTitle,
  onSave,
  onClose,
}: {
  dates: LogDates;
  mediaTitle: string;
  /** Awaited, so a server 400 lands in the sheet rather than closing over it. */
  onSave: (dates: LogDates) => Promise<void>;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const [draft, setDraft] = useState<LogDates>(dates);
  const [picking, setPicking] = useState<'startedAt' | 'finishedAt' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const problem = validateLogDates(draft, todayIso());
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave(draft);
      sheet.dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
      setSaving(false);
    }
  };

  return (
    <Sheet title="Dates" subtitle={mediaTitle} controller={sheet}>
      <View style={styles.rows}>
        <DateRow
          label="Started"
          value={draft.startedAt}
          onPress={() => setPicking('startedAt')}
          onClear={() => setDraft((current) => ({ ...current, startedAt: null }))}
        />
        <DateRow
          label="Finished"
          value={draft.finishedAt}
          onPress={() => setPicking('finishedAt')}
          onClear={() => setDraft((current) => ({ ...current, finishedAt: null }))}
        />
      </View>

      <Text style={[type.bodySm, styles.hint]}>
        A finish date is what files a title under a year on your history; an unfinished one files
        under its start.
      </Text>

      {error ? <SheetError message={error} /> : null}

      <View style={styles.actions}>
        <PrismButton
          label="Clear both"
          variant="secondary"
          disabled={saving || (draft.startedAt === null && draft.finishedAt === null)}
          onPress={() => setDraft({ startedAt: null, finishedAt: null })}
          style={styles.action}
        />
        <PrismButton label="Save" busy={saving} onPress={() => void save()} style={styles.action} />
      </View>

      {picking ? (
        <DateTimePicker
          value={isoToDate(draft[picking] ?? todayIso())}
          mode="date"
          // Android's dialog is its own window; iOS renders inline, and the
          // spinner is the only variant that fits a sheet this short.
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minimumDate={isoToDate(LOG_DATE_FLOOR)}
          maximumDate={isoToDate(todayIso())}
          onChange={(event, selected) => {
            // Android reports the dismissal as an event type; iOS's inline
            // picker only ever reports 'set', and is closed by the row again.
            if (event.type === 'dismissed' || !selected) {
              setPicking(null);
              return;
            }
            const field = picking;
            setDraft((current) => ({ ...current, [field]: dateToIso(selected) }));
            if (Platform.OS !== 'ios') setPicking(null);
          }}
        />
      ) : null}
    </Sheet>
  );
}

function DateRow({
  label,
  value,
  onPress,
  onClear,
}: {
  label: string;
  value: string | null;
  onPress: () => void;
  onClear: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? shortDate(value) : 'not set'}`}
        onPress={onPress}
        android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[type.eyebrow, text.dim]}>{label.toUpperCase()}</Text>
        <Text style={[type.button, value ? text.pink : text.faint]}>
          {value ? `${shortDate(value)} ${value.slice(0, 4)}` : 'SET DATE'}
        </Text>
      </Pressable>
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()} date`}
          onPress={onClear}
          style={({ pressed }) => [styles.clear, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="close" color={color.dim} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space.lg,
  },
  clear: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    color: color.dim,
  },
  actions: {
    flexDirection: 'row',
    gap: space.md,
  },
  action: {
    flex: 1,
  },
});

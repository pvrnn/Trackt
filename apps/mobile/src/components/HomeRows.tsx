import { KIND_LABELS_SINGULAR, activityVerbLabel, relativeTime } from '@trackt/client';
import { trackingVerbLabel, type ActivityEntry, type UpNextEntry } from '@trackt/shared';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { KindDot } from './KindDot';
import { AnimatedPressable, ripple, usePressMotion } from './Press';
import { SwipeCheckIn } from './SwipeCheckIn';
import { Touchable } from './Touchable';
import type { PartWrite } from '../lib/offline';
import { duration, staggerDelay } from '../lib/motion';
import {
  color,
  layout,
  nativeSurface,
  radius,
  space,
  stroke,
  surface,
  text,
} from '../theme/tokens';
import { type } from '../theme/typography';

export function checkInWrite(entry: UpNextEntry): PartWrite {
  return { op: 'checkIn', id: entry.id, part: entry.next };
}

export function undoWrite(entry: UpNextEntry): PartWrite {
  return { op: 'uncheck', id: entry.id, part: entry.next };
}

export function partLabel(entry: UpNextEntry): string {
  return `${entry.partKind === 'episode' ? 'E' : 'CH'}${entry.next}`;
}

/**
 * One 72pt up-next row: 40×56 thumb, title, the part line, and the check-in.
 *
 * The row opens the title; the button inside it checks in; the whole row is
 * also the swipe target. A `Pressable` nested in a `Pressable` resolves to the
 * inner one on native, so the two tap targets do not fight — the invalid-markup
 * problem that forces web's card to keep the whole surface unlinked does not
 * exist here — and gesture-handler cancels the outer press the moment the pan
 * activates, so a swipe never also navigates.
 */
export function UpNextRow({
  entry,
  index,
  checkedIn,
  onCheckIn,
}: {
  entry: UpNextEntry;
  index: number;
  checkedIn: boolean;
  onCheckIn: () => void;
}) {
  const verb = trackingVerbLabel(entry.kind).toUpperCase();
  const action = `${trackingVerbLabel(entry.kind, 'present')} ${partLabel(entry)}`;
  const press = usePressMotion();
  return (
    <Animated.View entering={FadeIn.delay(staggerDelay(index)).duration(duration.commit)}>
      <SwipeCheckIn
        label={action}
        armedLabel={`Release to ${action}`}
        committed={checkedIn}
        onCommit={onCheckIn}
      >
        <Touchable href={`/media/${entry.slug}`} style={styles.row}>
          <Cover
            kind={entry.kind}
            title={entry.title}
            coverUrl={entry.coverUrl}
            width={40}
            showTitle={false}
          />
          <View style={styles.rowBody}>
            <Text style={[type.cardTitle, styles.rowTitle]} numberOfLines={1}>
              {entry.title}
            </Text>
            <View style={styles.metaRow}>
              <KindDot kind={entry.kind} />
              <Text style={[type.eyebrow, text.dim]}>
                {KIND_LABELS_SINGULAR[entry.kind]} · {partLabel(entry)}
                {entry.total ? ` OF ${entry.total}` : ''}
              </Text>
            </View>
          </View>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel={`Mark ${entry.title} ${partLabel(entry)} ${verb.toLowerCase()}`}
            accessibilityState={{ disabled: checkedIn }}
            accessibilityHint="Or swipe the row right"
            disabled={checkedIn}
            onPress={onCheckIn}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            android_ripple={ripple(true)}
            hitSlop={space.sm}
            style={[styles.check, press.animatedStyle]}
          >
            <Icon name="check" color={checkedIn ? color.dim : color.pink} />
            {checkedIn ? <Text style={[type.button, text.dim]}>{verb}</Text> : null}
          </AnimatedPressable>
        </Touchable>
      </SwipeCheckIn>
    </Animated.View>
  );
}

export function ActivityRow({ entry, first }: { entry: ActivityEntry; first: boolean }) {
  return (
    <Touchable
      href={`/media/${entry.slug}`}
      style={[styles.activityRow, !first && styles.activityDivider]}
    >
      <KindDot kind={entry.kind} />
      <Text style={[type.bodySm, styles.activityText]} numberOfLines={2}>
        {activityVerbLabel(entry)} {entry.title} <Text style={text.dim}>{entry.detail}</Text>
      </Text>
      <Text style={[type.eyebrow, text.dim]}>{relativeTime(entry.at)}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: nativeSurface.row,
  },
  rowBody: {
    flex: 1,
    gap: space.xs,
  },
  rowTitle: {
    color: color.fg,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  check: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingLeft: space.md,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    minHeight: layout.touchTarget,
  },
  activityDivider: {
    borderTopWidth: stroke,
    borderTopColor: surface.divider,
  },
  activityText: {
    flex: 1,
    color: color.fg,
  },
});

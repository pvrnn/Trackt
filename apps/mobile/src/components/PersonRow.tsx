import type { FriendState, UserSummary } from '@trackt/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { AnimatedPressable, ripple, usePressMotion } from './Press';
import { Touchable } from './Touchable';
import { PRISM, color, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** What the roster says under a name when it is a search result. */
export function friendStateNote(state: FriendState): string {
  if (state === 'friends') return 'FRIENDS';
  if (state === 'incoming') return 'WANTS TO BE FRIENDS';
  if (state === 'outgoing') return 'REQUEST SENT';
  if (state === 'self') return 'THIS IS YOU';
  return '';
}

/** The pill each state wears, and what pressing it does (`fCard` in the mockup). */
const ACTION: Record<FriendState, { label: string; tone: 'prism' | 'friends' | 'quiet' | 'add' }> =
  {
    incoming: { label: 'ACCEPT', tone: 'prism' },
    friends: { label: 'FRIENDS', tone: 'friends' },
    outgoing: { label: 'REQUESTED', tone: 'quiet' },
    none: { label: 'ADD', tone: 'add' },
    self: { label: 'YOU', tone: 'quiet' },
  };

export function PersonRow({
  person,
  state,
  note,
  disabled,
  onAct,
  onDecline,
}: {
  person: UserSummary;
  state: FriendState;
  note: string;
  disabled: boolean;
  onAct: () => void;
  onDecline: () => void;
}) {
  const action = ACTION[state];
  const press = usePressMotion();
  const inert = disabled || state === 'self';

  return (
    <Touchable
      href={`/users/${person.username}`}
      style={[styles.row, state === 'incoming' && styles.rowRequest]}
    >
      <Avatar name={person.username} image={person.image} size={40} />
      <View style={styles.rowText}>
        <Text style={[type.cardTitle, text.fg]} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          @{person.username}
          {note ? ` · ${note}` : ''}
        </Text>
      </View>

      {/* A decline needs its own target, and it is the quiet one: the mockup
          gives it a 30pt ring beside the pill rather than a second label. */}
      {state === 'incoming' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decline ${person.name}`}
          disabled={disabled}
          onPress={onDecline}
          hitSlop={space.sm}
          style={({ pressed }) => [styles.decline, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="close" color={color.dim} size={12} />
        </Pressable>
      ) : null}

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={`${action.label.toLowerCase()} ${person.name}`}
        accessibilityState={{ disabled: inert }}
        disabled={inert}
        onPress={onAct}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        android_ripple={ripple()}
        style={[styles.pill, inert && styles.pillInert, press.animatedStyle]}
      >
        {action.tone === 'prism' ? (
          <LinearGradient
            colors={[...PRISM]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.pillFill, styles.pillPrism]}
          >
            <Text style={[styles.pillLabel, text.onPrism]}>{action.label}</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.pillFill, TONES[action.tone]]}>
            <Text style={[styles.pillLabel, TONE_TEXT[action.tone]]}>{action.label}</Text>
          </View>
        )}
      </AnimatedPressable>
    </Touchable>
  );
}

export function RosterTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.8 : 1 }]}
    >
      {active ? (
        <LinearGradient
          colors={[color.pink, color.kindMovie]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.tabFill, styles.tabActive]}
        >
          <Text style={[styles.tabLabel, text.onPrism]}>{label}</Text>
        </LinearGradient>
      ) : (
        <View style={[styles.tabFill, styles.tabIdle]}>
          <Text style={[styles.tabLabel, text.dim]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md - 1,
    padding: space.md - 1,
    borderRadius: radius.cardSm - 4,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowRequest: {
    borderColor: 'rgba(217,164,65,0.4)',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.4,
    color: color.dim,
  },
  decline: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
  },
  /**
   * Geometry only. The rounding belongs to the face below, never to a parent
   * clipping it: `overflow: 'hidden'` against a pill radius chops a corner off
   * the gradient on Android, and on the `AnimatedPressable` the media screen
   * uses it drops the child's paint altogether.
   */
  pill: {
    alignSelf: 'flex-start',
  },
  pillInert: {
    opacity: 0.6,
  },
  pillFill: {
    paddingVertical: space.sm + 1,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    // The toned faces ring themselves in a point; the gradient has no ring, and
    // needs a transparent one so both sit at the same height in the row.
    borderWidth: stroke,
    borderColor: 'transparent',
  },
  pillPrism: {
    borderColor: 'transparent',
  },
  pillLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.6,
    includeFontPadding: false,
  },
  tab: {
    alignSelf: 'flex-start',
  },
  tabFill: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md + 1,
    borderRadius: radius.pill,
    // Both faces carry the ring so the selected tab is exactly as tall as the
    // two beside it — the gradient's is just invisible.
    borderWidth: stroke,
    borderColor: 'transparent',
  },
  tabIdle: {
    borderColor: surface.glassBorderStrong,
  },
  tabActive: {
    borderColor: 'transparent',
  },
  tabLabel: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 10,
    letterSpacing: 0.8,
    includeFontPadding: false,
  },
});

/** The three non-PRISM pill skins, kept beside the styles they belong to. */
const TONES = StyleSheet.create({
  prism: {},
  friends: {
    borderWidth: stroke,
    borderColor: 'rgba(139,92,246,0.5)',
    backgroundColor: 'rgba(139,92,246,0.16)',
  },
  quiet: {
    borderWidth: stroke,
    borderColor: surface.glassBorderStrong,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  add: {
    borderWidth: stroke,
    borderColor: 'rgba(217,107,176,0.5)',
    backgroundColor: 'rgba(217,107,176,0.14)',
  },
});

const TONE_TEXT = StyleSheet.create({
  prism: { color: color.onPrism },
  friends: { color: '#c4b5fd' },
  quiet: { color: color.dim },
  add: { color: color.pink },
});

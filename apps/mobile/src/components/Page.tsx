import { relativeTime } from '@trackt/client';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactElement, ReactNode } from 'react';
import type { RefreshControlProps } from 'react-native';
import { duration } from '../lib/motion';
import { useIsOnline } from '../lib/network';
import { AuraBackground } from './AuraBackground';
import { Icon } from './Icon';
import { PrismText } from './PrismText';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The furniture every phase-2 screen shares.
 *
 * `Screen` (next door) owns the scrolling form layout the auth flow needs. The
 * read screens are lists instead — a `FlashList` has to own the scroll to
 * recycle rows — so `PageFrame` gives them the aura and the safe areas and
 * nothing else, and the list supplies its own header and padding.
 */
export function PageFrame({
  children,
  /**
   * Fade the content in when the screen takes focus — the tab-switch motion
   * (`Mobile System.dc.html` §07, 140ms micro). Opt-in, and only the tab
   * screens opt in: a pushed screen already arrives on the platform's own
   * horizontal transition, and fading its content on top of that would be two
   * animations for one navigation.
   */
  fadeOnFocus = false,
}: {
  children: ReactNode;
  fadeOnFocus?: boolean;
}) {
  return (
    <View style={styles.frame}>
      {/* The aura never fades: it is identical on all four tabs, so animating
          it would be motion with nothing to say. */}
      <AuraBackground />
      {fadeOnFocus ? <FocusFade>{children}</FocusFade> : children}
    </View>
  );
}

/**
 * The tab content's entrance. `useFocusEffect` rather than an `entering`
 * layout animation because the tab screens stay mounted — `TabSlot` keeps a
 * visited tab alive so its scroll position and its queries survive — and a
 * mount animation on a component that mounts once would play exactly once.
 */
function FocusFade({ children }: { children: ReactNode }) {
  const fade = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      fade.value = 0;
      fade.value = withTiming(1, { duration: duration.micro });
    }, [fade]),
  );

  const style = useAnimatedStyle(() => ({ opacity: fade.value }));

  return <Animated.View style={[styles.frame, style]}>{children}</Animated.View>;
}

/**
 * `PageFrame` plus the scroll container the pushed (non-tab) screens want: safe
 * areas top and bottom, the 20pt gutters, and 28pt between section children.
 *
 * The tab screens do not use it — theirs is a `FlashList` that owns its own
 * scroll so it can recycle rows, and a list inside a `ScrollView` recycles
 * nothing.
 */
export function PageScroll({
  children,
  refreshControl,
}: {
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <PageFrame>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxl },
        ]}
        {...(refreshControl ? { refreshControl } : {})}
      >
        {children}
      </ScrollView>
    </PageFrame>
  );
}

/**
 * The Anton page title, in the scroll flow (iOS large-title behaviour, and the
 * cross-platform baseline). The collapse into a 44pt glass bar is per-screen
 * rather than built in here: only the media screen scrolls far enough under a
 * hero for it to mean anything, so the bar lives there (`HeaderBar`).
 *
 * `count` is the gradient eyebrow the mockups pair with every title: "12
 * TITLES", "N UPDATES FROM YOUR LIBRARY".
 */
export function PageTitle({ title, count }: { title: string; count?: string | undefined }) {
  return (
    <View style={styles.pageTitle}>
      <Text style={[type.title, styles.titleText]}>{title.toUpperCase()}</Text>
      {count ? (
        <View style={styles.shrink}>
          <PrismText style={type.eyebrow}>{count.toUpperCase()}</PrismText>
        </View>
      ) : null}
    </View>
  );
}

/** Anton 22, the section rule between blocks of a screen. */
export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={[type.section, styles.titleText]}>{title.toUpperCase()}</Text>
      {action}
    </View>
  );
}

/** A back affordance for pushed screens. iOS wants a chevron; Android's is the system gesture. */
export function BackLink({ label = 'Back' }: { label?: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name="chevron-left" color={color.dim} size={16} />
      <Text style={[type.eyebrow, styles.backText]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/** The centred spinner every query shows before its first paint. */
export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={color.pink} />
    </View>
  );
}

/**
 * The dashed glass card the mockups use for "nothing here" — one component for
 * every empty and failed state, because the difference between them is the copy
 * and occasionally an action, never the shape.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={[type.section, styles.titleText]}>{title.toUpperCase()}</Text>
      <Text style={[type.bodySm, styles.emptyBody]}>{body}</Text>
      {action}
    </View>
  );
}

/**
 * "This is what we had last time we could ask" (mobile plan, phase 5).
 *
 * A read screen offline serves its persisted cache, and the whole point of
 * doing that instead of spinning is that the user can still look things up on
 * the tube. What it must not do is let them mistake it for live: the one thing
 * an offline screen owes its reader is the age of what it is showing.
 *
 * Renders nothing while online. Nothing while there is nothing to date either
 * — a screen with no data has a `StaleNotice`'s job done by `OfflineState`
 * below, and a strip saying "updated 0M ago" over an empty screen is a lie.
 */
export function StaleNotice({ updatedAt }: { updatedAt: number }) {
  const isOnline = useIsOnline();
  if (isOnline || !updatedAt) return null;
  return (
    <View style={styles.stale}>
      <Text style={[type.eyebrow, styles.staleText]}>
        OFFLINE · UPDATED {relativeTime(new Date(updatedAt).toISOString())} AGO
      </Text>
    </View>
  );
}

/**
 * The other half: what a screen shows while it is waiting, when the wait is
 * offline with nothing cached for it at all.
 *
 * Wraps the skeleton rather than sitting beside it so the rule lives in one
 * place and no screen has to reach for `useIsOnline` to state it. Without it
 * the screen skeletons forever: `networkMode: 'online'` *pauses* a query it
 * cannot run rather than failing it, so `isPending` never resolves and the
 * loading state is indistinguishable from a hang.
 */
export function OfflineFallback({ children }: { children: ReactNode }) {
  const isOnline = useIsOnline();
  if (isOnline) return <>{children}</>;
  return (
    <EmptyState
      title="You're offline"
      body="This loads the moment the instance is reachable again. Anything you check in until then is queued and sent when it is."
    />
  );
}

/** The bottom padding a tab screen's scroll content needs to clear the glass bar. */
export function useTabContentInset(): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + layout.tabBarHeight + space.xl;
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    backgroundColor: color.ink,
  },
  scroll: {
    paddingHorizontal: layout.gutter,
    gap: layout.sectionGap,
  },
  pageTitle: {
    gap: space.sm,
    paddingBottom: space.lg,
  },
  titleText: {
    color: color.fg,
  },
  // PrismText sizes itself to its mask, so it needs a shrink-to-fit parent.
  shrink: {
    alignSelf: 'flex-start',
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingBottom: space.md,
  },
  back: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
  },
  backText: {
    color: color.dim,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
  },
  stale: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  staleText: {
    color: color.muted,
  },
  empty: {
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.xl,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  emptyBody: {
    color: color.muted,
  },
});

import { relativeTime } from '@trackt/client';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
 * The aura and nothing else, for screens whose list owns the scroll.
 * (`Screen` next door owns the scrolling form layout the auth flow needs.)
 */
export function PageFrame({
  children,
  /** The tab-switch fade (§07). Tab screens only: a pushed screen already animates. */
  fadeOnFocus = false,
}: {
  children: ReactNode;
  fadeOnFocus?: boolean;
}) {
  return (
    <View style={styles.frame}>
      {/* The aura never fades: it is identical on all four tabs. */}
      <AuraBackground />
      {fadeOnFocus ? <FocusFade>{children}</FocusFade> : children}
    </View>
  );
}

/**
 * `useFocusEffect` rather than an `entering` animation: tab screens stay
 * mounted, so a mount animation would play exactly once.
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

/** `PageFrame` plus the scroll container the pushed (non-tab) screens want. */
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
 * The Anton page title, in the scroll flow. The collapse into a glass bar is
 * per-screen (`CollapsingHeader`); `count` is the gradient eyebrow beside it.
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

/** The dashed glass card for every empty and failed state — copy differs, shape never does. */
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
 * "This is what we had last time we could ask" — the age of a cache being
 * served offline. Nothing while online, and nothing with no data to date.
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
 * What a screen shows while waiting offline with nothing cached. Without it the
 * screen skeletons forever: `networkMode: 'online'` *pauses* a query it cannot
 * run rather than failing it, so `isPending` never resolves.
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

/**
 * The three states every query-backed section has, in one place: waiting,
 * failed, and answered — with the offline rules already applied. A pending
 * screen offline says so rather than spinning forever (`networkMode: 'online'`
 * pauses the query, so `isPending` never resolves), and an answered one carries
 * its own `StaleNotice`.
 *
 * Children take the resolved data, so the screen does not restate the
 * `isError || !data` narrowing that got it there.
 */
export function QueryState<T>({
  query,
  error,
  pending,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; dataUpdatedAt: number };
  error: { title: string; body: string };
  /** The waiting state, when a spinner is not the right shape for it. */
  pending?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <OfflineFallback>{pending ?? <Loading />}</OfflineFallback>;
  if (query.isError || query.data === undefined) {
    return <EmptyState title={error.title} body={error.body} />;
  }
  return (
    <>
      <StaleNotice updatedAt={query.dataUpdatedAt} />
      {children(query.data)}
    </>
  );
}

/**
 * The same three states when they are the whole screen rather than a section of
 * one — a pushed route whose subject failed to load has nothing else to show.
 */
export function ScreenState({
  isPending,
  backLabel,
  title,
  body,
}: {
  isPending: boolean;
  backLabel?: string;
  title: string;
  body: string;
}) {
  return (
    <PageScroll>
      <BackLink {...(backLabel ? { label: backLabel } : {})} />
      {isPending ? (
        <OfflineFallback>
          <Loading />
        </OfflineFallback>
      ) : (
        <EmptyState title={title} body={body} />
      )}
    </PageScroll>
  );
}

/** The app's pull-to-refresh, which is pink everywhere it appears. */
export function pullToRefresh(refreshing: boolean, onRefresh: () => void) {
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={color.pink}
      colors={[color.pink]}
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

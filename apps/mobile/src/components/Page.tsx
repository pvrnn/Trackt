import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactElement, ReactNode } from 'react';
import type { RefreshControlProps } from 'react-native';
import { AuraBackground } from './AuraBackground';
import { PrismText } from './PrismText';
import { color, layout, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The furniture every phase-2 screen shares.
 *
 * `Screen` (next door) owns the scrolling form layout the auth flow needs. The
 * read screens are lists instead — a `FlashList` has to own the scroll to
 * recycle rows — so `PageFrame` gives them the aura and the safe areas and
 * nothing else, and the list supplies its own header and padding.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <View style={styles.frame}>
      <AuraBackground />
      {children}
    </View>
  );
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
 * cross-platform baseline — the Android Material large top app bar collapse is
 * phase 4's job, not a data-parity concern).
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
      <Text style={[type.eyebrow, styles.backText]}>‹ {label.toUpperCase()}</Text>
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
    justifyContent: 'center',
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

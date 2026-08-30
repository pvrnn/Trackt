import { BlurView } from 'expo-blur';
import { useNavigation, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import type { AnimatedStyle, SharedValue } from 'react-native-reanimated';
import type { StyleProp, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { color, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** The collapsed bar `Mobile System.dc.html` fixes for both platforms: 44pt. */
export const HEADER_HEIGHT = layout.touchTarget;

/** How far the hero scrolls before the bar's glass is fully opaque. */
const GLASS_FADE = [120, 220] as const;

/**
 * The hand-off, in two beats rather than one. The floating state — the pill and
 * the back *label* — leaves first; the title arrives only once it has gone.
 *
 * They share the row, so a single range would cross-fade two pieces of
 * uppercase text through each other at half opacity, and the endpoint
 * (`< PROFILE HISTORY`, on one line) reads as neither one thing nor two.
 * Disjoint ranges make it a hand-off instead: one caption at a time, and the
 * title gets the whole bar to be long in. The label has said what it had to say
 * by then — it names where you came from, which is what you need on arrival,
 * not four screens deep into a list.
 */
const LABEL_FADE = [120, 170] as const;
const TITLE_FADE = [175, 220] as const;

/**
 * Where the collapsed title starts: the gutter, then the chevron, its gap, and
 * a breath. Measured from the bar's edge rather than its padding — an absolute
 * child is laid out against the border box, so the row's own gutter is not
 * applied for us.
 */
const TITLE_INSET = layout.gutter + 16 + space.xs + space.md;

/**
 * What the screen behind this one is called, keyed by route.
 *
 * A back link that says "Back" tells the user nothing they did not already
 * know; the platform convention is to name the place it returns to, and the
 * only way to know that is to read it off the stack rather than let each screen
 * hardcode a guess — `media/[slug]` alone is pushed from five places.
 *
 * Keys are route names with their `(group)` segments stripped. The parameterised
 * routes get the kind of thing they show, not its title: the label is an
 * uppercase eyebrow beside the collapsed title, and a work's name is neither
 * short enough nor knowable from the route.
 */
const BACK_LABELS: Record<string, string> = {
  home: 'Home',
  discover: 'Discover',
  news: 'News',
  profile: 'Profile',
  history: 'History',
  friends: 'Friends',
  'lists/index': 'Lists',
  'lists/[id]': 'List',
  'news/[slug]': 'Article',
  'users/[username]': 'Profile',
};

/** A route as the navigator holds it — the shape we read, not the full type. */
type StackRoute = {
  name: string;
  state?: { index?: number; routes?: StackRoute[] } | undefined;
};

/**
 * The deepest focused route under `route`, as a `BACK_LABELS` key. The tab
 * shell is one route in the stack, so the tab you were actually on is a level
 * down; `(app)` and `(tabs)` are layout groups and never part of a name a
 * reader would recognise.
 */
function routeKey(route: StackRoute): string {
  const nested = route.state;
  const children = nested?.routes;
  if (children && children.length > 0) {
    const child = children[nested?.index ?? children.length - 1];
    if (child) return routeKey(child);
  }
  return route.name
    .split('/')
    .filter((segment) => !segment.startsWith('('))
    .join('/');
}

/**
 * The name of the screen `router.back()` would return to, or `Back` when the
 * stack cannot name it — a media page pushed from another media page, where the
 * only honest label is the work's title and the route does not carry it.
 */
export function useBackLabel(): string {
  const navigation = useNavigation();
  const state = navigation.getState() as { index: number; routes: StackRoute[] } | undefined;
  if (!state || state.index < 1) return 'Back';
  const previous = state.routes[state.index - 1];
  return (previous && BACK_LABELS[routeKey(previous)]) ?? 'Back';
}

/**
 * A back affordance for pushed screens. iOS wants a chevron; Android's is the
 * system gesture.
 *
 * `labelStyle` is how the header fades the caption out from under the title
 * without the chevron going with it: the label is the part that has said what
 * it had to say, the chevron is the way out and stays.
 */
export function BackLink({
  label,
  labelStyle,
}: {
  label?: string;
  labelStyle?: StyleProp<AnimatedStyle<TextStyle>>;
}) {
  const router = useRouter();
  const derived = useBackLabel();
  return (
    <Pressable
      accessibilityRole="button"
      // Spoken even while the label is faded out, which is the state a screen
      // spends most of its life in.
      accessibilityLabel={`Back to ${label ?? derived}`}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name="chevron-left" color={color.dim} size={16} />
      <Animated.Text style={[type.eyebrow, text.dim, labelStyle]} numberOfLines={1}>
        {(label ?? derived).toUpperCase()}
      </Animated.Text>
    </Pressable>
  );
}

/**
 * The 44pt bar every pushed screen collapses into (`Mobile System.dc.html`,
 * platform table: "collapses to a 44pt glass bar on scroll" on iOS, the small
 * app bar on Android — the same geometry either way).
 *
 * It is pinned rather than scrolled with the content, and it is the same bar on
 * every pushed screen. Both of those are the point: a back link that scrolls
 * away strands the reader at the bottom of a long article, and one that is a
 * plain row here and a floating pill there reads as two different controls.
 *
 * The back chevron does **not** fade: it is the screen's only in-app way out on
 * iOS, and an affordance that appears only once you have scrolled past it is
 * worse than no affordance. Only the glass and the title cross-fade in, and
 * they do it from the *hero* title's position, so what the bar shows is the
 * thing that just left rather than a new label.
 */
export function CollapsingHeader({
  title,
  scrollY,
}: {
  /** The screen's own title, which fades in as the in-flow one leaves. */
  title?: string | undefined;
  scrollY: SharedValue<number>;
}) {
  const insets = useSafeAreaInsets();

  const glassStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...GLASS_FADE], [0, 1], 'clamp'),
  }));

  // Over the hero art the back link needs its own ink to sit on (the mockup's
  // floating pill); once the bar's own glass has arrived it would be a second
  // surface on top of a surface, so it goes with the label it was carrying.
  const floatStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...LABEL_FADE], [1, 0], 'clamp'),
  }));

  const titleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [...TITLE_FADE], [0, 1], 'clamp'),
  }));

  return (
    <View
      style={[styles.headerBar, { paddingTop: insets.top, height: insets.top + HEADER_HEIGHT }]}
      pointerEvents="box-none"
    >
      <Animated.View
        style={[StyleSheet.absoluteFill, glassStyle]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
        {/* The blur alone is not enough: §05 forbids content behind fighting
            the text. Same 82% ink the tab bar puts over its own blur. */}
        <View style={[StyleSheet.absoluteFill, styles.headerFill]} />
        <View style={styles.headerRule} />
      </Animated.View>
      <View style={styles.headerRow}>
        <View>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.backPill, floatStyle]}
            pointerEvents="none"
          />
          {/* The label only steps aside when there is a title to step aside
              *for*: a screen with no title (a failed one) would otherwise
              scroll to a bare chevron and nothing else. */}
          <BackLink {...(title ? { labelStyle: floatStyle } : {})} />
        </View>
        {/* Out of the flow, and deliberately over the label's own space: the
            two are never both visible, so the title has the bar from the
            chevron to the far gutter rather than whatever the label left it. */}
        {title ? (
          <Animated.View style={[styles.titleSlot, titleStyle]} pointerEvents="none">
            <Text numberOfLines={1} style={[type.section, text.fg]}>
              {title.toUpperCase()}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
  },
  headerBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  headerFill: {
    backgroundColor: 'rgba(14,12,16,0.82)',
  },
  headerRule: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: stroke,
    backgroundColor: surface.glassBorder,
  },
  headerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.gutter,
  },
  titleSlot: {
    position: 'absolute',
    left: TITLE_INSET,
    right: layout.gutter,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  backPill: {
    borderRadius: radius.pill,
    backgroundColor: 'rgba(14,12,16,0.62)',
    borderWidth: stroke,
    // The fill is *darker* than the aura behind it, so this rim is the only
    // thing keeping the shape off bright hero art. At `glassBorderStrong` it
    // stopped reading as glass and started reading as a white outline drawn
    // around a dark plate; a hairline of 10% is the edge without the outline.
    borderColor: surface.glassBorder,
    marginVertical: space.xs,
    // The pill is 36 tall, so its caps are 18 — and the two sides are not
    // symmetric. The chevron's glyph box carries its own whitespace, where the
    // label's last letter ends flush and needs the full cap to clear.
    marginLeft: -space.sm,
    marginRight: -space.lg,
  },
});

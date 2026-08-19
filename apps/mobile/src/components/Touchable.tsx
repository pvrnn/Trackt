import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { AnimatedPressable, ripple, usePressMotion } from './Press';

/**
 * A pressable that navigates — the app's one way to make a row, tile or card
 * open a route.
 *
 * Deliberately **not** `<Link asChild><Pressable/></Link>`. `asChild` renders a
 * Radix `Slot`, which merges its own `style` prop into the child's; when the
 * child's style is a function of press state (`({ pressed }) => …`) that merge
 * silently drops it, so the row renders with no background, no height and no
 * `flexDirection` — which is exactly what every list in this app looked like
 * before this component existed. The Slot also throws outright on an array
 * style in development.
 *
 * Routing through `router.push` keeps the styling contract ordinary: this is a
 * plain `Pressable`, and its `style` behaves the way `Pressable`'s does.
 *
 * The opacity dip is the iOS convention and the cross-platform floor;
 * `android_ripple` adds Android's pink ripple over it (`Mobile System.dc.html`
 * §06). Phase 4 puts the dip and its 140ms spring on the UI thread
 * (`usePressMotion`), which is also why `style` is static: the press state no
 * longer re-renders anything.
 */
export function Touchable({
  href,
  children,
  style,
  accessibilityLabel,
}: {
  href: Href;
  children: ReactNode;
  /** Static styles only — no function form is needed, press state is handled here. */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const router = useRouter();
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="link"
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      onPress={() => router.push(href)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple()}
      style={[style, press.animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

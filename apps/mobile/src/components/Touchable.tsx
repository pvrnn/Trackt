import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { AnimatedPressable, ripple, usePressMotion } from './Press';

/**
 * The app's one way to make a row, tile or card open a route.
 *
 * Deliberately **not** `<Link asChild><Pressable/></Link>`: `asChild` renders a
 * Radix `Slot` that merges its own `style` into the child's, silently dropping
 * a function-of-press-state style and throwing outright on an array one. Going
 * through `router.push` keeps this a plain `Pressable`.
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

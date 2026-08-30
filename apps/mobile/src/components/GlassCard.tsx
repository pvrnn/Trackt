import { BlurView } from 'expo-blur';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { radius, stroke, surface } from '../theme/tokens';

/**
 * The glass surface, ported from web's `GlassCard` (design README: blur 16,
 * `rgba(255,255,255,0.05)` fill, `0.10` border).
 *
 * `expo-blur` is the `backdrop-filter` stand-in. Its `intensity` is a 0–100
 * scale rather than a pixel radius, so 16px maps by eye rather than by formula;
 * `tint="dark"` keeps it from washing the near-black background grey.
 *
 * The fill and border go on a wrapper rather than the `BlurView` itself: on
 * Android the blur is an overlay view that clips its own children badly, and a
 * border drawn on it disappears at some elevations.
 */
export function GlassCard({
  children,
  style,
  strongBorder = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The `0.15` border variant — used where a card is the focus of the screen. */
  strongBorder?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        { borderColor: strongBorder ? surface.glassBorderStrong : surface.glassBorder },
        style,
      ]}
    >
      <BlurView intensity={24} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.fill]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: stroke,
    overflow: 'hidden',
  },
  fill: {
    backgroundColor: surface.glass,
  },
});

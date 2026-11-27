import type { ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { color, radius, space, stroke, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The labelled glass input, ported from web's `Input` (design README: glass
 * fill, 12px radius, Space Grotesk label tracked out and uppercased).
 *
 * `error` renders under the field and tints the border, matching how the web
 * forms report per-field validation. Both are announced: the label is the
 * accessibility label, the error goes in the hint, so a screen reader reaching
 * the field hears why it was rejected without hunting for the text below it.
 */
export function Field({
  label,
  error,
  trailing,
  style,
  ...props
}: TextInputProps & { label: string; error?: string | undefined; trailing?: ReactNode }) {
  return (
    <View style={styles.wrap}>
      <Text style={[type.eyebrow, styles.label]}>{label.toUpperCase()}</Text>
      <View style={[styles.box, error ? styles.inputError : null]}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error}
          placeholderTextColor={color.dim}
          style={[styles.input, type.input, style]}
          {...props}
        />
        {trailing}
      </View>
      {error ? (
        <Text style={[type.bodySm, styles.error]} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  label: {
    color: color.dim,
  },
  box: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: surface.glassWell,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    borderRadius: radius.cover,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 48,
    paddingHorizontal: space.lg,
    // iOS draws a single-line input's text a few points below centre; this lifts it back.
    paddingTop: 0,
    paddingBottom: 6,
    color: color.fg,
  },
  inputError: {
    borderColor: color.pink,
  },
  error: {
    color: color.pink,
  },
});

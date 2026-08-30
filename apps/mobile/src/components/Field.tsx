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
  style,
  ...props
}: TextInputProps & { label: string; error?: string | undefined }) {
  return (
    <View style={styles.wrap}>
      <Text style={[type.eyebrow, styles.label]}>{label.toUpperCase()}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={color.faint}
        style={[styles.input, type.body, error ? styles.inputError : null, style]}
        {...props}
      />
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
  input: {
    backgroundColor: surface.glassWell,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    borderRadius: radius.cover,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    color: color.fg,
  },
  inputError: {
    borderColor: color.pink,
  },
  error: {
    color: color.pink,
  },
});

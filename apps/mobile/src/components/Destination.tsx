import { Pressable, StyleSheet, Text } from 'react-native';
import { Icon, type IconName } from './Icon';
import { ripple } from './Press';
import { Touchable } from './Touchable';
import { color, layout, radius, space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * One navigation row: a pink glyph, the destination, what is behind it, and a
 * chevron (`Mobile App.dc.html`, profile). Not the two-line card it used to be —
 * at 14/600 with the count on the right, four of these fit where two did, which
 * is the point of moving lists and history *into* the profile in the first
 * place.
 */
export function Destination({
  icon,
  href,
  label,
  meta,
  onPress,
}: {
  icon: IconName;
  href?: '/history' | '/lists' | '/friends';
  label: string;
  meta?: string | undefined;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Icon name={icon} color={color.pink} size={17} />
      <Text style={[type.cardTitle, styles.rowLabel]}>{label}</Text>
      {meta ? <Text style={[type.eyebrow, text.dim]}>{meta.toUpperCase()}</Text> : null}
      <Icon name="chevron-right" color={color.faint} size={16} />
    </>
  );

  if (href) {
    return (
      <Touchable href={href} style={styles.destination}>
        {body}
      </Touchable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      android_ripple={ripple()}
      style={({ pressed }) => [styles.destination, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget + 6,
    paddingHorizontal: space.lg,
    borderRadius: radius.cardSm - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowLabel: {
    flex: 1,
    color: color.fg,
  },
});

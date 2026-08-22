import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PRISM, color, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon, type IconName } from './Icon';
import { AnimatedPressable, ripple, usePressMotion } from './Press';
import { PrismText } from './PrismText';

/**
 * The action row: one primary, two satellites (`Mobile Media.dc.html`).
 *
 * The primary names the *next unit* and nothing more — "READ CH 113", "WATCH
 * E4" — because that is the sentence someone opens this screen to say. It is
 * the one PRISM surface on the page. Beside it sit favourite and add-to-list as
 * 52pt discs with two-line captions: recognisable without being loud, and
 * reachable with the same thumb.
 *
 * The old pill row this replaces carried five equal-weight pills — log, dates,
 * rate, favourite, list — which made the daily action look like one option of
 * five. Status and dates moved into the hero (they are state, not actions),
 * rating became its own card below (it has a value to show), and what is left
 * here is what you press.
 */
export function MediaActionRow({
  label,
  caughtUp,
  favorited,
  onPrimary,
  onToggleFavorite,
  onAddToList,
}: {
  /** 'READ CH 113' / 'WATCH E4' / 'CAUGHT UP' — already in caps. */
  label: string;
  /** Nothing left to check in: the button stops being the PRISM one. */
  caughtUp: boolean;
  favorited: boolean;
  onPrimary: () => void;
  onToggleFavorite: () => void;
  onAddToList: () => void;
}) {
  const press = usePressMotion();

  return (
    <View style={styles.row}>
      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel={label.toLowerCase()}
        onPress={onPrimary}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        android_ripple={ripple(true)}
        style={[styles.primary, caughtUp && styles.primaryDone, press.animatedStyle]}
      >
        {caughtUp ? (
          <View style={styles.primaryInner}>
            <Icon name="star-filled" color={color.muted} size={15} />
            <Text style={[type.button, styles.muted]}>{label}</Text>
          </View>
        ) : (
          <LinearGradient
            colors={[...PRISM]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryInner}
          >
            <Icon name="check" color={color.onPrism} size={16} />
            <Text style={[type.button, styles.onPrism]} numberOfLines={1}>
              {label}
            </Text>
          </LinearGradient>
        )}
      </AnimatedPressable>

      <SatelliteButton
        icon={favorited ? 'heart-filled' : 'heart'}
        caption="FAV"
        active={favorited}
        label={favorited ? 'Remove from favourites' : 'Add to favourites'}
        onPress={onToggleFavorite}
      />
      <SatelliteButton icon="plus" caption="LIST" label="Add to a list" onPress={onAddToList} />
    </View>
  );
}

function SatelliteButton({
  icon,
  caption,
  label,
  active = false,
  onPress,
}: {
  icon: IconName;
  caption: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple(true)}
      style={[styles.satellite, active && styles.satelliteActive, press.animatedStyle]}
    >
      <Icon name={icon} color={active ? color.pink : color.muted} size={15} />
      <Text style={[styles.caption, active ? styles.pink : styles.dim]}>{caption}</Text>
    </AnimatedPressable>
  );
}

/**
 * The rating, as a readout you can edit rather than a pill that opens a sheet:
 * your score in PRISM at 30, what the instance thinks under it, and a pencil.
 *
 * Community score sits *inside* the same card because the two numbers are only
 * meaningful next to each other — 9.5 against a 9.1 average is a different
 * statement from 9.5 against a 6.2 one.
 */
export function RatingCard({
  score,
  communityScore,
  ratingCount,
  onPress,
}: {
  score: number | null;
  communityScore: number | null;
  ratingCount: number;
  onPress: () => void;
}) {
  const community =
    communityScore !== null
      ? `${communityScore.toFixed(1)} FROM ${ratingCount} HERE`
      : 'NO RATINGS HERE YET';

  return (
    <View style={styles.ratingRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          score !== null ? `Your rating: ${score.toFixed(1)}. Change it` : 'Rate this'
        }
        onPress={onPress}
        style={({ pressed }) => [styles.rating, { opacity: pressed ? 0.75 : 1 }]}
      >
        {score !== null ? (
          <View style={styles.shrink}>
            <PrismText style={styles.score}>{score.toFixed(1)}</PrismText>
          </View>
        ) : (
          <Text style={[styles.score, styles.faint]}>—</Text>
        )}
        <View style={styles.ratingText}>
          <Text style={[type.eyebrow, styles.muted]}>YOUR RATING</Text>
          <Text style={[type.eyebrow, styles.dim]} numberOfLines={1}>
            {community}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={score !== null ? 'Edit your rating' : 'Rate this'}
        onPress={onPress}
        android_ripple={{ color: surface.pinkRow }}
        style={({ pressed }) => [styles.pencil, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Icon name="pencil" color={color.pink} size={17} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.sm,
  },
  primary: {
    flex: 1,
    height: 52,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  primaryDone: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  primaryInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  satellite: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  satelliteActive: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  caption: {
    fontFamily: type.eyebrow.fontFamily,
    fontSize: 8,
    letterSpacing: 0.64,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  rating: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  score: {
    fontFamily: type.stat.fontFamily,
    fontSize: 30,
    lineHeight: 32,
  },
  shrink: {
    alignSelf: 'center',
  },
  ratingText: {
    flex: 1,
    gap: 1,
  },
  pencil: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  onPrism: {
    color: color.onPrism,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
  faint: {
    color: color.faint,
  },
  pink: {
    color: color.pink,
  },
});

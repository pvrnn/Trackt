import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Icon } from './Icon';
import { AnimatedPressable, ripple, usePressMotion } from './Press';
import { PRISM, color, control, layout, radius, stroke } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * Close and back (`Mobile System.dc.html` §08): a 32pt visible disc in a 44pt
 * target. `opaque` is for a button sitting over artwork, where a translucent
 * disc disappears into a light cover.
 */
function DiscButton({
  icon,
  label,
  onPress,
  disc,
  opaque,
  style,
}: {
  icon: 'close' | 'chevron-left';
  label: string;
  onPress: () => void;
  disc: boolean;
  opaque: boolean;
  style?: StyleProp<ViewStyle> | undefined;
}) {
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple(true)}
      style={[styles.target, style, press.animatedStyle]}
    >
      {disc ? (
        <View style={[styles.disc, opaque ? styles.discOpaque : styles.discGlass]}>
          <Icon name={icon} color={color.fg} size={icon === 'close' ? 14 : 18} />
        </View>
      ) : (
        <Icon name={icon} color={color.fg} size={24} />
      )}
    </AnimatedPressable>
  );
}

export function CloseButton({
  onPress,
  label,
  opaque = false,
  style,
}: {
  onPress: () => void;
  /** Spoken label; defaults to `common.close`. */
  label?: string;
  opaque?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  return (
    <DiscButton
      icon="close"
      label={label ?? t('common.close')}
      onPress={onPress}
      disc
      opaque={opaque}
      style={style}
    />
  );
}

/**
 * A chevron-only back target for a screen header's left edge. Without `onPress`
 * it pops the stack, or lands on Home when there is nothing to pop. `disc`
 * draws the 32pt disc; a plain header leaves the chevron bare.
 */
export function BackButton({
  onPress,
  label,
  disc = false,
  opaque = false,
  style,
}: {
  onPress?: () => void;
  label?: string;
  disc?: boolean;
  opaque?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <DiscButton
      icon="chevron-left"
      label={label ?? t('common.back')}
      onPress={onPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/home')))}
      disc={disc || opaque}
      opaque={opaque}
      style={style}
    />
  );
}

/**
 * The sheet and step-page header line (§08): where you are on the left, the
 * close target on the right, on one 44pt centre line; progress bars under it,
 * full width. Nothing else shares the row with the close button.
 */
export function StepHeader({
  label,
  emphasis,
  onClose,
  closeLabel,
  progress,
  style,
}: {
  /** "STEP 1 OF 3" — uppercased here. */
  label: string;
  /** The location after the step, in full ink: "IMPORT". */
  emphasis?: string | undefined;
  /** Omit for a header with no way out. */
  onClose?: (() => void) | undefined;
  closeLabel?: string | undefined;
  /** 1-based step of `total`; segments up to `step` are lit. */
  progress?: { step: number; total: number } | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={style}>
      <View style={styles.line}>
        <Text style={[type.eyebrow, styles.label]} numberOfLines={1}>
          {label.toUpperCase()}
          {emphasis ? <Text style={styles.emphasis}>{` · ${emphasis.toUpperCase()}`}</Text> : null}
        </Text>
        {onClose ? (
          <CloseButton
            onPress={onClose}
            {...(closeLabel ? { label: closeLabel } : {})}
            style={styles.closeEdge}
          />
        ) : null}
      </View>
      {progress ? (
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: progress.total, now: progress.step }}
        >
          {Array.from({ length: progress.total }, (_, index) =>
            index < progress.step ? (
              <LinearGradient
                key={index}
                colors={[...PRISM]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.segment}
              />
            ) : (
              <View key={index} style={[styles.segment, styles.segmentEmpty]} />
            ),
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    width: control.disc,
    height: control.disc,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discGlass: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  discOpaque: {
    backgroundColor: color.onPrism,
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  line: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    flex: 1,
    color: color.dim,
  },
  emphasis: {
    color: color.fg,
  },
  // The disc, not the 44pt target, meets the content edge.
  closeEdge: {
    marginRight: -(layout.touchTarget - control.disc) / 2,
  },
  progress: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 6,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
  },
  segmentEmpty: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});

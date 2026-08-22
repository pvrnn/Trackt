import { partWindow, type PartBlock } from '@trackt/client';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { PRISM, color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Icon } from './Icon';
import { AnimatedPressable, ripple, usePressMotion } from './Press';

/**
 * The work, as rows you can actually read (`Mobile Media.dc.html`).
 *
 * A 1120-chapter manga used to be 1120 tiles. It is now 28 block rows — each
 * with its own bar and n/40 — and one opened block showing a **window** of six
 * parts around where you are: two behind, the next one ringed pink, three
 * ahead. Never the whole block, never the whole work. Travelling further than
 * six rows is the slider's job, not scrolling's.
 *
 * Every row writes the *position*, which is what makes this a view onto one
 * integer rather than a second source of truth: tapping part 140 marks
 * everything up to it, and tapping a part you have already done sets the
 * position to one below — which is how an overshoot gets corrected without a
 * dialog.
 */
export function PartBlockRow({
  block,
  label,
  rangeLabel,
  open,
  onPress,
}: {
  block: PartBlock;
  /** 'Volume 3' / 'Episodes 41–80'. */
  label: string;
  /** 'CH 81–120'. */
  rangeLabel: string;
  open: boolean;
  onPress: () => void;
}) {
  const press = usePressMotion();
  const percent = Math.round((block.done / block.size) * 100);

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}, ${rangeLabel}, ${block.done} of ${block.size} done`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple()}
      style={[styles.blockRow, open && styles.blockRowOpen, press.animatedStyle]}
    >
      <Marker complete={block.complete} partial={block.partial} size={24} />
      <View style={styles.blockBody}>
        <View style={styles.blockTitleRow}>
          <Text style={[type.cardTitle, block.complete ? styles.muted : styles.fg]}>{label}</Text>
          <Text style={[type.eyebrow, styles.dim]}>{rangeLabel}</Text>
        </View>
        <View style={styles.mini}>
          {block.done > 0 ? (
            block.complete ? (
              <LinearGradient
                colors={[...PRISM]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.miniFill, { width: `${percent}%` }]}
              />
            ) : (
              <View style={[styles.miniFill, styles.miniPink, { width: `${percent}%` }]} />
            )
          ) : null}
        </View>
      </View>
      <Text style={[type.eyebrow, block.done > 0 ? styles.pink : styles.dim]}>
        {block.done}/{block.size}
      </Text>
    </AnimatedPressable>
  );
}

/** One part in the opened window: a check, a name, and where it stands. */
export function PartRow({
  label,
  done,
  isNext,
  onPress,
}: {
  /** 'Chapter 113' / 'Episode 4'. */
  label: string;
  done: boolean;
  isNext: boolean;
  onPress: () => void;
}) {
  const press = usePressMotion();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: done }}
      accessibilityLabel={`${label}${done ? ' — done, tap to unset' : isNext ? ' — up next' : ''}`}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      android_ripple={ripple()}
      style={[styles.partRow, isNext && styles.partRowNext, press.animatedStyle]}
    >
      <Marker complete={done} partial={false} outlined={isNext} size={20} />
      <Text style={[type.label, done ? styles.muted : styles.fg, styles.partLabel]}>{label}</Text>
      {done || isNext ? (
        <Text style={[type.eyebrow, isNext ? styles.pink : styles.dim]}>
          {done ? 'DONE' : 'NEXT'}
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}

/** The filled / half / empty disc every row wears on its left. */
function Marker({
  complete,
  partial,
  outlined = false,
  size,
}: {
  complete: boolean;
  partial: boolean;
  outlined?: boolean;
  size: number;
}) {
  return (
    <View
      style={[
        styles.marker,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: complete ? color.pink : 'transparent',
          borderColor: complete || partial || outlined ? color.pink : surface.glassBorderStrong,
        },
      ]}
    >
      {complete ? <Icon name="check" color={color.onPrism} size={size - 8} /> : null}
      {!complete && partial ? <View style={styles.markerDot} /> : null}
    </View>
  );
}

/** The rows an open block renders — the window, not the block. */
export function partWindowRows(block: PartBlock, position: number): number[] {
  return partWindow(block.from, block.to, position);
}

const styles = StyleSheet.create({
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.cover,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  blockRowOpen: {
    borderColor: surface.pinkBorder,
    backgroundColor: surface.pinkRow,
  },
  blockBody: {
    flex: 1,
    gap: space.xs,
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
  },
  mini: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: surface.glassBorder,
  },
  miniFill: {
    height: 3,
    borderRadius: 2,
  },
  miniPink: {
    backgroundColor: color.pink,
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
    paddingHorizontal: space.md,
    borderRadius: radius.thumb,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  partRowNext: {
    borderColor: surface.pinkBorderStrong,
    backgroundColor: surface.pinkRow,
  },
  partLabel: {
    flex: 1,
  },
  marker: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  markerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.pink,
  },
  fg: {
    color: color.fg,
  },
  muted: {
    color: color.muted,
  },
  dim: {
    color: color.dim,
  },
  pink: {
    color: color.pink,
  },
});

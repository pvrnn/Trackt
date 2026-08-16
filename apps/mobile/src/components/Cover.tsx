import { coverGradientStops } from '@trackt/client';
import type { MediaKind } from '@trackt/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { resolveInstanceUrl } from '../lib/instance';
import { PRISM, color, radius, space } from '../theme/tokens';
import { font } from '../theme/typography';

/**
 * A 2:3 poster. Real artwork when the catalog has any, the deterministic
 * generated gradient when it doesn't — and the generated one is not a
 * placeholder: `coverGradientStops` is shared with `apps/web`, so a title's
 * cover is the same picture on both clients (design README, "Generated covers").
 *
 * The cover URL is instance-relative (`/uploads/…`), so it goes through
 * `resolveInstanceUrl` rather than into `source` directly — ADR-0008 §2. A
 * provider CDN URL passes through that helper untouched.
 *
 * `title` is drawn over the gradient only. Over artwork it would be a second,
 * unreadable copy of the caption the card already carries.
 */
export function Cover({
  kind,
  title,
  coverUrl,
  width,
  progress,
  style,
  showTitle = true,
}: {
  kind: MediaKind;
  title: string;
  coverUrl: string | null | undefined;
  width: number;
  /** 0–1 completion, drawn as the PRISM bar along the bottom edge. Omit to hide it. */
  progress?: number | undefined;
  style?: StyleProp<ViewStyle>;
  showTitle?: boolean;
}) {
  const source = resolveInstanceUrl(coverUrl);
  const [from, to] = coverGradientStops(kind, title);
  const height = Math.round((width * 3) / 2);

  return (
    <View style={[styles.frame, { width, height }, style]}>
      <LinearGradient
        colors={[from, to]}
        // 160deg in CSS terms: mostly downward, tilted left.
        start={{ x: 0.7, y: 0 }}
        end={{ x: 0.3, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {source ? (
        <Image
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          accessibilityLabel={title}
        />
      ) : showTitle ? (
        <Text
          style={[styles.title, { fontSize: Math.max(11, Math.round(width / 7)) }]}
          numberOfLines={3}
        >
          {title.toUpperCase()}
        </Text>
      ) : null}
      {progress !== undefined && progress > 0 ? (
        <View style={styles.track}>
          <LinearGradient
            colors={[...PRISM]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: `${Math.min(100, Math.round(progress * 100))}%`, height: '100%' }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.cover,
    overflow: 'hidden',
    backgroundColor: color.ink,
  },
  title: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    bottom: space.md,
    fontFamily: font.display,
    color: 'rgba(255,255,255,0.94)',
    lineHeight: undefined,
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
});

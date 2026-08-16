import { avatarGradientStops } from '@trackt/client';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';
import { resolveInstanceUrl } from '../lib/instance';
import { font } from '../theme/typography';

/**
 * The round avatar: the uploaded image when there is one, otherwise the
 * deterministic gradient initial `apps/web` draws from the same hash.
 *
 * The stored `image` is instance-relative, so like every cover it goes through
 * `resolveInstanceUrl` (ADR-0008 §2).
 */
export function Avatar({
  name,
  image,
  size = 48,
}: {
  name: string;
  image?: string | null | undefined;
  size?: number;
}) {
  const source = resolveInstanceUrl(image);
  const { stops, color } = avatarGradientStops(name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <LinearGradient
        colors={[...stops]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {source ? (
        <Image
          source={{ uri: source }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={180}
          accessibilityLabel={name}
        />
      ) : (
        <Text style={[styles.initial, { color, fontSize: Math.round(size * 0.42) }]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: font.display,
  },
});

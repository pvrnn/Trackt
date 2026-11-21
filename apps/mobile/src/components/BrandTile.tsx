import { IMPORT_SOURCE_MARKS } from '@trackt/client';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color, stroke, surface } from '../theme/tokens';
import { font } from '../theme/typography';

/**
 * An import source's official mark on its own colour, as an app-icon tile.
 * Decorative: the service's name is always written beside it. A source with no
 * mark yet gets its initial rather than a borrowed logo.
 */
export function BrandTile({
  source,
  label,
  size = 40,
}: {
  source: string;
  label: string;
  size?: number;
}) {
  const mark = IMPORT_SOURCE_MARKS[source];
  const frame = { width: size, height: size, borderRadius: Math.round(size * 0.275) };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, frame, { backgroundColor: mark?.color ?? surface.glassWell }]}
    >
      {mark ? (
        <Svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24">
          <Path d={mark.path} fill={mark.ink ?? '#ffffff'} />
        </Svg>
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>
          {(label.trim()[0] ?? '?').toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  initial: {
    fontFamily: font.display,
    color: color.fg,
    includeFontPadding: false,
  },
});

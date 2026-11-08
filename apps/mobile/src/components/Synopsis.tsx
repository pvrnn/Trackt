import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * How much of the paragraph is shown before the fade: nine lines of the body
 * scale. Fixed rather than a fraction of the work's own text — a synopsis
 * should sit at the same place on the page whether its provider wrote two
 * sentences or ten.
 */
const COLLAPSED_LINES = 9;

/**
 * The synopsis: nine lines dissolving into the page, then a ruled
 * `SHOW MORE` line. Not a button and not a chip — the rules make it read as a
 * cut through the paragraph, which is what it is.
 *
 * The paragraph is masked with a vertical gradient so it fades out rather than
 * being chopped; the hidden copy below measures the real line count, because a
 * `numberOfLines`-clamped Text reports only the lines it kept.
 */
export function Synopsis({ text: body }: { text: string }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const collapsible = lines !== null && lines > COLLAPSED_LINES;

  return (
    <View>
      {collapsible && !expanded ? (
        <MaskedView
          style={styles.clamp}
          maskElement={
            <LinearGradient
              colors={['black', 'black', 'transparent']}
              locations={[0, 0.62, 1]}
              style={StyleSheet.absoluteFill}
            />
          }
        >
          <Text
            numberOfLines={COLLAPSED_LINES}
            ellipsizeMode="clip"
            style={[type.body, text.muted]}
          >
            {body}
          </Text>
        </MaskedView>
      ) : (
        <Text style={[type.body, text.muted]}>{body}</Text>
      )}

      {/* Out of the flow and invisible: the only way to learn the full line
          count of a paragraph that is otherwise clamped and faded. */}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onTextLayout={(event) => {
          if (lines === null) setLines(event.nativeEvent.lines.length);
        }}
        style={[type.body, text.muted, styles.measure]}
      >
        {body}
      </Text>

      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={styles.more}
        >
          <View style={styles.rule} />
          <Text style={[type.eyebrow, text.pink]}>
            {expanded ? t('media.synopsis.collapse') : t('media.synopsis.expand')}
          </Text>
          <View style={styles.rule} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clamp: {
    height: COLLAPSED_LINES * type.body.lineHeight,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  rule: {
    flex: 1,
    height: stroke,
    backgroundColor: surface.glassBorderStrong,
  },
});

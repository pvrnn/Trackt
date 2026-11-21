import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { color, layout, text } from '../theme/tokens';
import { font, type } from '../theme/typography';

const COLLAPSED_LINES = 3;

/**
 * ABOUT: three lines, then SHOW MORE. The hidden copy measures the real line
 * count, because a `numberOfLines`-clamped Text reports only the lines it kept.
 */
export function Synopsis({ text: body }: { text: string }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const collapsible = lines !== null && lines > COLLAPSED_LINES;

  return (
    <View>
      <Text
        {...(collapsible && !expanded ? { numberOfLines: COLLAPSED_LINES } : {})}
        style={styles.body}
      >
        {body}
      </Text>

      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onTextLayout={(event) => {
          if (lines === null) setLines(event.nativeEvent.lines.length);
        }}
        style={[styles.body, styles.measure]}
      >
        {body}
      </Text>

      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.more, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.moreLabel, text.pinkInk]}>
            {expanded ? t('media.synopsis.collapse') : t('media.synopsis.expand')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    ...type.body,
    color: color.muted,
  },
  measure: {
    position: 'absolute',
    left: 0,
    right: 0,
    opacity: 0,
  },
  more: {
    alignSelf: 'flex-start',
    minHeight: layout.touchTarget,
    justifyContent: 'center',
  },
  moreLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: 0.88,
  },
});

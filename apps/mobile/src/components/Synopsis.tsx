import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { space, text } from '../theme/tokens';
import { type } from '../theme/typography';

/** How much of the paragraph stays visible before the "display more" line. */
const VISIBLE = 0.75;

/**
 * The synopsis, held at three quarters of its height with a plain line under it
 * to open the rest — not a button, not a chip: it reads as the continuation of
 * the paragraph it belongs to.
 *
 * The clamp is a line count, measured once from the full paragraph, because a
 * description is as long as its provider made it: a fixed line count either
 * hides a two-line synopsis behind a link it does not need, or barely trims a
 * fifteen-line one.
 */
export function Synopsis({ text: body }: { text: string }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const visible = lines === null ? null : Math.max(1, Math.ceil(lines * VISIBLE));
  const collapsible = visible !== null && lines !== null && visible < lines;

  return (
    <View>
      <Text
        style={[type.body, text.muted]}
        numberOfLines={!expanded && collapsible ? visible : undefined}
        onTextLayout={(event) => {
          if (lines === null) setLines(event.nativeEvent.lines.length);
        }}
      >
        {body}
      </Text>
      {collapsible ? (
        <Text
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={[type.eyebrow, text.pink, styles.toggle]}
        >
          {expanded ? t('media.synopsis.collapse') : t('media.synopsis.expand')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    marginTop: space.sm,
  },
});

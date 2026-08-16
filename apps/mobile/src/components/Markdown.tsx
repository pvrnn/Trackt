import { parseMarkdown, type InlineToken, type MarkdownBlock } from '@trackt/client';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, Text, View } from 'react-native';
import { color, space, surface } from '../theme/tokens';
import { font, type } from '../theme/typography';

/**
 * The native half of the article renderer (ADR-0005). The tokenizer is
 * `@trackt/client`'s; this maps its tokens onto `<Text>`.
 *
 * The "React elements, never HTML strings" guarantee survives the port for free
 * and then some: there is no `WebView` anywhere on this path, so model-authored
 * prose cannot execute even in principle. A markdown-to-HTML renderer in a
 * WebView would have given all of that back.
 *
 * Links open in the in-app browser rather than kicking out to Safari/Chrome —
 * and only ever `http(s)`, because `safeHref` has already rejected everything
 * else during tokenizing.
 */
export function Markdown({ body }: { body: string }) {
  return (
    <View style={styles.blocks}>
      {parseMarkdown(body).map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}

const HEADING_SIZES = [26, 21, 17] as const;

function Block({ block }: { block: MarkdownBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text style={[styles.heading, { fontSize: HEADING_SIZES[block.level - 1] }]}>
          <Inline tokens={block.content} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text style={[type.body, styles.paragraph]}>
          <Inline tokens={block.content} />
        </Text>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <Text style={[type.body, styles.marker]}>
                {block.ordered ? `${index + 1}.` : '•'}
              </Text>
              <Text style={[type.body, styles.paragraph, styles.itemText]}>
                <Inline tokens={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={[type.body, styles.quoteText]}>
            <Inline tokens={block.content} />
          </Text>
        </View>
      );
  }
}

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'strong':
            return (
              <Text key={index} style={styles.strong}>
                {token.text}
              </Text>
            );
          case 'em':
            return (
              <Text key={index} style={styles.em}>
                {token.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={index} style={styles.code}>
                {token.text}
              </Text>
            );
          case 'link':
            return (
              <Text
                key={index}
                style={styles.link}
                accessibilityRole="link"
                onPress={() => void WebBrowser.openBrowserAsync(token.href)}
              >
                {token.text}
              </Text>
            );
          case 'text':
            return <Text key={index}>{token.text}</Text>;
        }
      })}
    </>
  );
}

const styles = StyleSheet.create({
  blocks: {
    gap: space.lg,
  },
  heading: {
    fontFamily: font.display,
    color: color.fg,
    textTransform: 'uppercase',
  },
  paragraph: {
    color: color.muted,
    lineHeight: 26,
  },
  list: {
    gap: space.sm,
  },
  item: {
    flexDirection: 'row',
    gap: space.sm,
  },
  marker: {
    color: color.dim,
  },
  itemText: {
    flex: 1,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: color.pink,
    paddingLeft: space.lg,
  },
  quoteText: {
    color: color.dim,
    fontStyle: 'italic',
  },
  strong: {
    fontFamily: font.bodyBold,
    color: color.fg,
  },
  em: {
    fontStyle: 'italic',
  },
  code: {
    fontFamily: font.label,
    fontSize: 13,
    backgroundColor: surface.glassWell,
  },
  link: {
    color: color.pink,
    textDecorationLine: 'underline',
  },
});

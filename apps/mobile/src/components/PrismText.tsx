import MaskedViewNative from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentType, ReactElement } from 'react';
import { Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewProps } from 'react-native';
import { PRISM } from '../theme/tokens';

// masked-view 0.3.2's class type is built on `NativeMethods`, which React Native 0.88 no longer exports.
const MaskedView = MaskedViewNative as unknown as ComponentType<
  ViewProps & { maskElement: ReactElement }
>;

/**
 * PRISM gradient text (design README: "only on key display words and hero
 * stats"), web's `.text-prism`.
 *
 * `background-clip: text` does not exist in React Native, so the text is drawn
 * twice: once as a mask, once as the gradient it reveals. The mask copy must be
 * opaque — `MaskedView` reads alpha, so a transparent glyph masks nothing.
 *
 * The gradient is laid out by the mask, which means the component sizes itself
 * to the text. Wrapping it in anything that stretches it (a `flex: 1` row)
 * stretches the gradient too, so callers keep it in a shrink-to-fit parent.
 */
export function PrismText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return (
    <MaskedView
      maskElement={
        <View>
          <Text style={style} allowFontScaling={false}>
            {children}
          </Text>
        </View>
      }
    >
      <LinearGradient colors={[...PRISM]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
        {/* Transparent copy: sizes the gradient to the glyphs, draws nothing. */}
        <Text style={[style, { opacity: 0 }]} allowFontScaling={false}>
          {children}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
}

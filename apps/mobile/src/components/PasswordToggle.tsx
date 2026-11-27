import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { color, space } from '../theme/tokens';
import { type } from '../theme/typography';

/** Web's `PasswordToggle`: SHOW / HIDE at the end of a password `Field`. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('auth.showPasswordAria')}
      accessibilityState={{ selected: shown }}
      onPress={onToggle}
      hitSlop={8}
      style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[type.eyebrow, styles.label]}>
        {shown ? t('auth.hidePassword') : t('auth.showPassword')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toggle: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  label: {
    color: color.muted,
  },
});

import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Sheet, useSheetController } from './Sheet';
import { PrismButton } from './PrismButton';
import { storeLocale } from '../lib/storage';
import { i18n } from '../i18n';
import { SUPPORTED_LOCALES } from '../i18n';
import { space } from '../theme/tokens';

/**
 * Bottom sheet for picking the UI language. Opened from the circular language
 * button in the top right of the profile header.
 */
export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const sheet = useSheetController(onClose);
  const { t } = useTranslation();

  const pick = (loc: (typeof SUPPORTED_LOCALES)[number]) => {
    void storeLocale(loc);
    void i18n.changeLanguage(loc);
    sheet.dismiss();
  };

  return (
    <Sheet title={t('locale.switch')} controller={sheet}>
      <View style={styles.list}>
        {SUPPORTED_LOCALES.map((loc) => (
          <PrismButton
            key={loc}
            label={t(`locale.${loc}`)}
            variant={i18n.language === loc ? 'primary' : 'secondary'}
            onPress={() => pick(loc)}
          />
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space.sm,
  },
});

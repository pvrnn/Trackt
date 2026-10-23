import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '../../i18n';
import { useLocale } from '../../i18n/use-locale';

const MENU_ITEM =
  'flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-fg outline-none transition ' +
  'data-[highlighted]:bg-pink-row data-[highlighted]:text-pink';

/**
 * Endonyms, never translated: someone looking for French under an English UI
 * still reads "Français", not "French".
 */
const ENDONYMS: Record<Locale, string> = { en: 'English', fr: 'Français' };

/** Compact `EN`/`FR` pill for the account and marketing menus. */
export function LocaleMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('locale.switch')}
        className={clsx(
          'cursor-pointer rounded-full border border-glass-border-strong bg-glass px-3.5 py-2 font-label text-xs font-semibold tracking-label text-muted transition outline-none hover:border-pink hover:text-pink',
          className,
        )}
      >
        {locale.toUpperCase()}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-30 w-40 overflow-hidden rounded-card-sm border border-glass-border-strong bg-ink/90 py-1 shadow-xl backdrop-blur-[16px]"
        >
          {SUPPORTED_LOCALES.map((value) => (
            <DropdownMenu.Item
              key={value}
              onSelect={() => setLocale(value)}
              aria-current={value === locale ? 'true' : undefined}
              className={MENU_ITEM}
            >
              <span>{ENDONYMS[value]}</span>
              {value === locale && <span aria-hidden>✓</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

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

/**
 * The nav's language control: a quiet menu, not a badge. The globe says what
 * it is and the caret says it opens.
 */
export function LocaleMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t('locale.switch')}
        className={clsx(
          'inline-flex h-9 cursor-pointer items-center gap-[7px] rounded-lg pr-[9px] pl-2.5 font-label text-xs font-bold tracking-[0.08em] text-muted transition outline-none',
          'hover:bg-white/8 hover:text-fg focus-visible:bg-white/8 focus-visible:text-fg data-[state=open]:bg-white/8 data-[state=open]:text-fg',
          className,
        )}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="size-[17px] shrink-0"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5S9.4 5.9 12 3.5z" />
        </svg>
        {locale.toUpperCase()}
        <span
          aria-hidden
          className="mb-1 ml-0.5 size-1.5 rotate-45 border-r-[1.5px] border-b-[1.5px] border-current opacity-80"
        />
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

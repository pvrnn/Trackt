import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/** The 404 body for a handle nobody on this instance answers to. */
export function NoSuchUser({ username }: { username: string }) {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex max-w-[760px] flex-col items-center gap-2 px-10 pt-20 pb-20 text-center">
      <p className="font-heading text-[32px] text-faint uppercase">
        {t('profile.public.notFoundTitle')}
      </p>
      <p className="max-w-[420px] text-sm text-muted">
        {t('profile.public.notFoundBody', { username })}
      </p>
      <Link
        to="/search"
        className="mt-2 font-label text-xs font-semibold tracking-label text-pink hover:brightness-115"
      >
        {t('profile.public.backToSearch')}
      </Link>
    </main>
  );
}

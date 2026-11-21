import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { AuthMode } from './AuthLayout';

/** SHOW / HIDE inside the password well. */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={t('auth.showPasswordAria')}
      className="cursor-pointer self-stretch px-4 font-label text-[11px] font-bold tracking-[0.08em] text-muted transition hover:text-pink"
    >
      {shown ? t('auth.hidePassword') : t('auth.showPassword')}
    </button>
  );
}

/** "New here? Create an account" under the submit button. */
export function AuthSwitch({ mode }: { mode: AuthMode }) {
  const { t } = useTranslation();
  const toRegister = mode === 'login';
  return (
    <p className="text-sm leading-normal text-muted">
      {t(toRegister ? 'auth.switchToRegister.text' : 'auth.switchToLogin.text')}{' '}
      <Link
        to={toRegister ? '/register' : '/login'}
        className="font-bold text-pink hover:brightness-115"
      >
        {t(toRegister ? 'auth.switchToRegister.action' : 'auth.switchToLogin.action')}
      </Link>
    </p>
  );
}

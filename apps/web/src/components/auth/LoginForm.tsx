import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorKey } from '@trackt/client';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { authClient } from '../../lib/auth-client';
import { openDoors } from '../../lib/door-transition';
import { AuthSwitch, PasswordToggle } from './AuthControls';

/** Email + password sign-in; honours the guard's `?redirect` on success. */
export function LoginForm({ redirect }: { redirect?: string }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const { error } = await authClient.signIn.email({ email: email.trim(), password });
    setSubmitting(false);
    // The server has already mailed a fresh code.
    if (error?.code === 'EMAIL_NOT_VERIFIED') {
      await navigate({ to: '/verify-email', search: { email: email.trim(), redirect } });
      return;
    }
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.signInFailed')));
      return;
    }
    await openDoors(() => (redirect ? navigate({ href: redirect }) : navigate({ to: '/home' })));
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6.5" noValidate>
        <div className="flex flex-col gap-4">
          <Input
            label={t('auth.fields.email')}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label={t('auth.fields.password')}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('auth.passwordHint.login')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            trailing={
              <PasswordToggle
                shown={showPassword}
                onToggle={() => setShowPassword((current) => !current)}
              />
            }
            required
          />
        </div>
        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full py-4.25" disabled={submitting}>
          {submitting ? t('auth.submitting') : t('auth.submit')}
        </Button>
      </form>
      <AuthSwitch mode="login" />
    </>
  );
}

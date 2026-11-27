import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorKey } from '@trackt/client';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { authClient } from '../../lib/auth-client';
import { openDoors } from '../../lib/door-transition';
import { AuthSwitch, PasswordToggle } from './AuthControls';

/** Mirrors better-auth's username plugin defaults (3–30 chars). */
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

interface Fields {
  username: string;
  email: string;
  password: string;
}

type ValidationKey =
  | 'auth.validation.usernameFormat'
  | 'auth.validation.emailRequired'
  | 'auth.validation.disposableEmail'
  | 'auth.validation.passwordLength';

function validate(f: Fields): Partial<Record<keyof Fields, ValidationKey>> {
  const errors: Partial<Record<keyof Fields, ValidationKey>> = {};
  if (!USERNAME_RE.test(f.username)) errors.username = 'auth.validation.usernameFormat';
  if (!f.email.trim()) errors.email = 'auth.validation.emailRequired';
  if (f.password.length < MIN_PASSWORD_LENGTH) errors.password = 'auth.validation.passwordLength';
  return errors;
}

/** Username, email and password; the display name starts as the username. */
export function RegisterForm() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [fields, setFields] = useState<Fields>({ username: '', email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, ValidationKey>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors = validate(fields);
    if (!errors.email) {
      // Loaded on submit: the blocklist is ~200 kB and only this form needs it.
      const { isDisposableEmail } = await import('@trackt/shared/disposable-email');
      if (isDisposableEmail(fields.email)) errors.email = 'auth.validation.disposableEmail';
    }
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const email = fields.email.trim();
    const { data, error } = await authClient.signUp.email({
      // The display name starts as the username; it is editable on the profile.
      name: fields.username,
      email,
      password: fields.password,
      username: fields.username,
    });
    setSubmitting(false);
    if (error?.code === 'DISPOSABLE_EMAIL') {
      setFieldErrors({ email: 'auth.validation.disposableEmail' });
      return;
    }
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.signUpFailed')));
      return;
    }
    // No token: the instance requires a verified email, and the code is on its way.
    if (!data?.token) {
      await navigate({ to: '/verify-email', search: { email } });
      return;
    }
    await openDoors(() => navigate({ to: '/home', search: { onboarding: true } }));
  }

  const error = (key: keyof Fields) =>
    fieldErrors[key] && t(fieldErrors[key], { min: MIN_PASSWORD_LENGTH });

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6.5" noValidate>
        <div className="flex flex-col gap-4">
          <Input
            label={t('auth.fields.username')}
            name="username"
            autoComplete="username"
            placeholder="marav"
            value={fields.username}
            onChange={set('username')}
            error={error('username')}
            required
          />
          <Input
            label={t('auth.fields.email')}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={fields.email}
            onChange={set('email')}
            error={error('email')}
            required
          />
          <Input
            label={t('auth.fields.password')}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={t('auth.passwordHint.register')}
            value={fields.password}
            onChange={set('password')}
            error={error('password')}
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
          {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Button>
      </form>
      <AuthSwitch mode="register" />
    </>
  );
}

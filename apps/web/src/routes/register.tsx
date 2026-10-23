import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthDivider, AuthLayout } from '../components/layout/AuthLayout';
import { Button, buttonClassName } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { authClient } from '../lib/auth-client';
import { authErrorKey } from '../lib/auth-errors';

export const Route = createFileRoute('/register')({
  head: ({ match }) => ({ meta: [{ title: match.context.i18n.t('meta.register') }] }),
  component: RegisterPage,
});

/** Mirrors better-auth's username plugin defaults (3–30 chars). */
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const MIN_PASSWORD_LENGTH = 8;

interface Fields {
  name: string;
  username: string;
  email: string;
  password: string;
  confirm: string;
}

type ValidationKey =
  | 'auth.validation.nameRequired'
  | 'auth.validation.usernameFormat'
  | 'auth.validation.emailRequired'
  | 'auth.validation.passwordLength'
  | 'auth.validation.passwordMismatch';

function validate(f: Fields): Partial<Record<keyof Fields, ValidationKey>> {
  const errors: Partial<Record<keyof Fields, ValidationKey>> = {};
  if (!f.name.trim()) errors.name = 'auth.validation.nameRequired';
  if (!USERNAME_RE.test(f.username)) errors.username = 'auth.validation.usernameFormat';
  if (!f.email.trim()) errors.email = 'auth.validation.emailRequired';
  if (f.password.length < MIN_PASSWORD_LENGTH) errors.password = 'auth.validation.passwordLength';
  if (f.confirm !== f.password) errors.confirm = 'auth.validation.passwordMismatch';
  return errors;
}

function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: session } = authClient.useSession();
  const [fields, setFields] = useState<Fields>({
    name: '',
    username: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, ValidationKey>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (session) return <Navigate to="/home" />;

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const errors = validate(fields);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    const { error } = await authClient.signUp.email({
      name: fields.name.trim(),
      email: fields.email.trim(),
      password: fields.password,
      username: fields.username,
    });
    setSubmitting(false);
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.signUpFailed')));
      return;
    }
    navigate({ to: '/home' });
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[44px] leading-none uppercase">
          {t('auth.register.title')}
        </h1>
        <p className="text-[15px] text-muted">{t('auth.register.subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
        <Input
          label={t('auth.fields.name')}
          name="name"
          autoComplete="name"
          placeholder="Paul"
          value={fields.name}
          onChange={set('name')}
          error={fieldErrors.name && t(fieldErrors.name, { min: MIN_PASSWORD_LENGTH })}
          required
        />
        <Input
          label={t('auth.fields.username')}
          name="username"
          autoComplete="username"
          placeholder="paulv"
          value={fields.username}
          onChange={set('username')}
          error={fieldErrors.username && t(fieldErrors.username, { min: MIN_PASSWORD_LENGTH })}
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
          error={fieldErrors.email && t(fieldErrors.email, { min: MIN_PASSWORD_LENGTH })}
          required
        />
        <Input
          label={t('auth.fields.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={fields.password}
          onChange={set('password')}
          error={fieldErrors.password && t(fieldErrors.password, { min: MIN_PASSWORD_LENGTH })}
          required
        />
        <Input
          label={t('auth.fields.confirmPassword')}
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={fields.confirm}
          onChange={set('confirm')}
          error={fieldErrors.confirm && t(fieldErrors.confirm, { min: MIN_PASSWORD_LENGTH })}
          required
        />
        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full text-sm" disabled={submitting}>
          {submitting ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Button>
      </form>
      <AuthDivider label={t('auth.alreadyMember')} />
      <Link to="/login" className={buttonClassName({ variant: 'secondary', className: 'w-full' })}>
        {t('auth.submit')}
      </Link>
    </AuthLayout>
  );
}

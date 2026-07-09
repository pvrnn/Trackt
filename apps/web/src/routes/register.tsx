import { createFileRoute, Link, Navigate, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { AuthDivider, AuthLayout } from '../components/layout/AuthLayout';
import { Button, buttonClassName } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { authClient } from '../lib/auth-client';

export const Route = createFileRoute('/register')({
  head: () => ({ meta: [{ title: 'Create account — Trackt' }] }),
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

function validate(f: Fields): Partial<Record<keyof Fields, string>> {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!f.name.trim()) errors.name = 'Name is required';
  if (!USERNAME_RE.test(f.username))
    errors.username = '3–30 characters: letters, numbers, dots, underscores';
  if (!f.email.trim()) errors.email = 'Email is required';
  if (f.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `At least ${MIN_PASSWORD_LENGTH} characters`;
  if (f.confirm !== f.password) errors.confirm = 'Passwords do not match';
  return errors;
}

function RegisterPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const [fields, setFields] = useState<Fields>({
    name: '',
    username: '',
    email: '',
    password: '',
    confirm: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Fields, string>>>({});
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
      setFormError(error.message ?? 'Sign up failed');
      return;
    }
    navigate({ to: '/home' });
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[44px] leading-none uppercase">Create account</h1>
        <p className="text-[15px] text-muted">
          Your history, ratings, and lists — exportable any time.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5" noValidate>
        <Input
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Paul"
          value={fields.name}
          onChange={set('name')}
          error={fieldErrors.name}
          required
        />
        <Input
          label="Username"
          name="username"
          autoComplete="username"
          placeholder="paulv"
          value={fields.username}
          onChange={set('username')}
          error={fieldErrors.username}
          required
        />
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={fields.email}
          onChange={set('email')}
          error={fieldErrors.email}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={fields.password}
          onChange={set('password')}
          error={fieldErrors.password}
          required
        />
        <Input
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••••"
          value={fields.confirm}
          onChange={set('confirm')}
          error={fieldErrors.confirm}
          required
        />
        {formError && (
          <p role="alert" className="text-sm text-red-400">
            {formError}
          </p>
        )}
        <Button type="submit" className="w-full text-sm" disabled={submitting}>
          {submitting ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT'}
        </Button>
      </form>
      <AuthDivider label="Already a member" />
      <Link to="/login" className={buttonClassName({ variant: 'secondary', className: 'w-full' })}>
        SIGN IN
      </Link>
    </AuthLayout>
  );
}

import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { authErrorKey } from '@trackt/client';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { authClient } from '../../lib/auth-client';
import { openDoors } from '../../lib/door-transition';

const CODE_RE = /^\d{6}$/;
const RESEND_COOLDOWN_S = 30;

/**
 * The 6-digit code from the verification email. The email's link lands here
 * with `?code=`, which is submitted on arrival: one code backs both, so the
 * link carries no credential of its own.
 */
export function VerifyEmailForm({
  email,
  code: linkCode,
  redirect,
}: {
  email?: string;
  code?: string;
  redirect?: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [code, setCode] = useState(linkCode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(otp: string) {
    if (!email) return;
    setSubmitting(true);
    setFormError(null);
    setNotice(null);
    const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
    setSubmitting(false);
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.verifyFailed')));
      return;
    }
    await openDoors(() =>
      redirect
        ? navigate({ href: redirect })
        : navigate({ to: '/home', search: { onboarding: true } }),
    );
  }

  useEffect(() => {
    if (autoSubmitted.current || !linkCode || !CODE_RE.test(linkCode)) return;
    autoSubmitted.current = true;
    void verify(linkCode);
    // Once, on arrival from the email link.
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const otp = code.trim();
    if (!CODE_RE.test(otp)) {
      setFormError(t('auth.verify.codeFormat'));
      return;
    }
    await verify(otp);
  }

  async function resend() {
    if (!email || cooldown > 0) return;
    setFormError(null);
    setCooldown(RESEND_COOLDOWN_S);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: 'email-verification',
    });
    if (error) {
      setFormError(t(authErrorKey(error, 'errors.generic')));
      return;
    }
    setNotice(t('auth.verify.resent'));
  }

  if (!email) {
    return (
      <p className="text-sm leading-normal text-muted">
        {t('auth.verify.noEmail')}{' '}
        <Link to="/login" className="font-bold text-pink hover:brightness-115">
          {t('auth.switchToLogin.action')}
        </Link>
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6.5" noValidate>
      <p className="m-0 text-sm leading-normal text-muted">
        {t('auth.verify.sentTo')} <span className="font-semibold text-fg">{email}</span>
      </p>
      <Input
        label={t('auth.verify.codeLabel')}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        className="font-mono tracking-[0.3em]"
        required
      />
      {formError && (
        <p role="alert" className="text-sm text-red-400">
          {formError}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full py-4.25" disabled={submitting}>
        {submitting ? t('auth.verify.submitting') : t('auth.verify.submit')}
      </Button>
      <p className="text-sm leading-normal text-muted">
        {t('auth.verify.noCode')}{' '}
        <button
          type="button"
          onClick={() => void resend()}
          disabled={cooldown > 0}
          className="cursor-pointer font-bold text-pink hover:brightness-115 disabled:cursor-default disabled:text-dim disabled:hover:brightness-100"
        >
          {cooldown > 0
            ? t('auth.verify.resendIn', { seconds: cooldown })
            : t('auth.verify.resend')}
        </button>
      </p>
    </form>
  );
}

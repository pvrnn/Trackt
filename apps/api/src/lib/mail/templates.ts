import type { MailMessage } from './mailer.js';

export type MailLocale = 'en' | 'fr';

/** Must match `LOCALE_COOKIE` in apps/web/src/i18n (ADR-0009). */
const LOCALE_COOKIE = 'trackt_locale';

/**
 * The web client's locale cookie first, then Accept-Language (the mobile app
 * has no cookie jar and sends its language as a header), then English.
 */
export function mailLocale(headers: Headers | undefined | null): MailLocale {
  const cookie = headers?.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(cookie);
  if (match?.[1] === 'fr' || match?.[1] === 'en') return match[1];
  const accept = headers?.get('accept-language')?.trim().toLowerCase() ?? '';
  return accept.startsWith('fr') ? 'fr' : 'en';
}

const COPY = {
  en: {
    subject: (code: string) => `${code} is your Trackt code`,
    heading: 'Confirm your email',
    intro: 'Enter this code to finish creating your Trackt account:',
    button: 'Confirm my email',
    linkHint: 'Or open this link:',
    expiry: 'The code expires in 10 minutes.',
    ignore: 'If you did not create an account, you can ignore this email.',
  },
  fr: {
    subject: (code: string) => `${code} est votre code Trackt`,
    heading: 'Confirmez votre adresse e-mail',
    intro: 'Saisissez ce code pour finir de créer votre compte Trackt :',
    button: 'Confirmer mon adresse',
    linkHint: 'Ou ouvrez ce lien :',
    expiry: 'Le code expire dans 10 minutes.',
    ignore: 'Si vous n’avez pas créé de compte, ignorez cet e-mail.',
  },
} satisfies Record<MailLocale, unknown>;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** One card layout for every message; `code` adds the big digits under the intro. */
function layout({
  locale,
  heading,
  intro,
  code,
  button,
  link,
  linkHint,
  footer,
}: {
  locale: MailLocale;
  heading: string;
  intro: string;
  code?: string;
  button: string;
  link: string;
  linkHint: string;
  footer: string[];
}): { html: string; text: string } {
  const href = escapeHtml(link);
  const text = [
    heading,
    '',
    intro,
    ...(code ? ['', `    ${code}`] : []),
    '',
    linkHint,
    link,
    '',
    ...footer,
  ].join('\n');
  const codeBlock = code
    ? `\n    <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:0.3em;font-family:ui-monospace,Menlo,monospace">${code}</p>`
    : '';
  const html = `<!doctype html>
<html lang="${locale}">
<body style="margin:0;padding:32px 16px;background:#0b090d;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#f4f1f8">
  <div style="max-width:440px;margin:0 auto;background:#16131b;border:1px solid #2a2532;border-radius:16px;padding:32px">
    <p style="margin:0 0 24px;font-size:22px;font-weight:700;letter-spacing:0.02em">TRACKT</p>
    <h1 style="margin:0 0 12px;font-size:20px">${heading}</h1>
    <p style="margin:0 0 20px;color:#b9b2c4;line-height:1.5">${intro}</p>${codeBlock}
    <a href="${href}" style="display:inline-block;background:#e0457b;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">${button}</a>
    <p style="margin:24px 0 4px;color:#8a8296;font-size:13px">${linkHint}</p>
    <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${href}" style="color:#b9b2c4">${href}</a></p>
    <p style="margin:0;color:#8a8296;font-size:13px;line-height:1.5">${footer.join('<br>')}</p>
  </div>
</body>
</html>`;
  return { html, text };
}

export function verificationEmail({
  to,
  code,
  link,
  locale,
}: {
  to: string;
  code: string;
  link: string;
  locale: MailLocale;
}): MailMessage {
  const copy = COPY[locale];
  const body = layout({
    locale,
    heading: copy.heading,
    intro: copy.intro,
    code,
    button: copy.button,
    link,
    linkHint: copy.linkHint,
    footer: [copy.expiry, copy.ignore],
  });
  return { to, subject: copy.subject(code), ...body };
}

const EXISTING_COPY = {
  en: {
    subject: 'You already have a Trackt account',
    heading: 'You already have an account',
    verified:
      'Someone just tried to create a Trackt account with this email address. It already has one, so nothing was created.',
    unverified:
      'Someone just tried to create a Trackt account with this email address. Sign-up was already started but never confirmed: sign in and we will send you a new code.',
    button: 'Sign in',
    linkHint: 'Or open this link:',
    ignore: 'If this was not you, you can ignore this email: your account is unchanged.',
  },
  fr: {
    subject: 'Vous avez déjà un compte Trackt',
    heading: 'Vous avez déjà un compte',
    verified:
      'Quelqu’un vient d’essayer de créer un compte Trackt avec cette adresse e-mail. Elle en a déjà un : rien n’a été créé.',
    unverified:
      'Quelqu’un vient d’essayer de créer un compte Trackt avec cette adresse e-mail. Une inscription a déjà été commencée sans être confirmée : connectez-vous et nous vous enverrons un nouveau code.',
    button: 'Se connecter',
    linkHint: 'Ou ouvrez ce lien :',
    ignore: 'Si ce n’était pas vous, ignorez cet e-mail : votre compte n’a pas changé.',
  },
} satisfies Record<MailLocale, unknown>;

/**
 * Sent instead of an error when sign-up hits a registered address: the form
 * answers as if the account were new (no enumeration), and only the mailbox
 * owner learns the truth.
 */
export function existingAccountEmail({
  to,
  verified,
  link,
  locale,
}: {
  to: string;
  verified: boolean;
  link: string;
  locale: MailLocale;
}): MailMessage {
  const copy = EXISTING_COPY[locale];
  const body = layout({
    locale,
    heading: copy.heading,
    intro: verified ? copy.verified : copy.unverified,
    button: copy.button,
    link,
    linkHint: copy.linkHint,
    footer: [copy.ignore],
  });
  return { to, subject: copy.subject, ...body };
}

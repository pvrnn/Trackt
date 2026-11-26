import { createTransport } from 'nodemailer';
import type { Env } from '@trackt/shared';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  /** Which transport this is, for the boot log. */
  readonly kind: 'resend' | 'smtp' | 'console';
  send(message: MailMessage): Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Resend over plain HTTPS: works on hosts that block outbound SMTP (Railway below Pro). */
export function resendMailer(
  apiKey: string,
  from: string,
  fetchImpl: typeof fetch = fetch,
): Mailer {
  return {
    kind: 'resend',
    async send({ to, subject, html, text }) {
      const response = await fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Resend rejected the message: ${response.status} ${await response.text()}`);
      }
    },
  };
}

export function smtpMailer(url: string, from: string): Mailer {
  const transport = createTransport(url);
  return {
    kind: 'smtp',
    async send({ to, subject, html, text }) {
      await transport.sendMail({ from, to, subject, html, text });
    },
  };
}

/** Development only: the message goes to stdout, so sign-up needs no mail account. */
export function consoleMailer(write: (line: string) => void = console.info): Mailer {
  return {
    kind: 'console',
    async send({ to, subject, text }) {
      write(`\n[trackt mail] to: ${to}\n[trackt mail] subject: ${subject}\n${text}\n`);
    },
  };
}

/**
 * Resend wins over SMTP when both are set. Production without either never
 * gets here with verification on — `loadEnv` refuses to boot — so the console
 * fallback there only serves an instance that sends no mail at all.
 */
export function createMailer(env: Env, fetchImpl?: typeof fetch): Mailer {
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM, fetchImpl);
  if (env.SMTP_URL) return smtpMailer(env.SMTP_URL, env.MAIL_FROM);
  return consoleMailer();
}

import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '@trackt/shared';
import { consoleMailer, createMailer, resendMailer } from '../../../src/lib/mail/mailer.js';
import {
  existingAccountEmail,
  mailLocale,
  verificationEmail,
} from '../../../src/lib/mail/templates.js';

const base = { NODE_ENV: 'test', LOG_LEVEL: 'error' } as const;
const message = { to: 'vera@example.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };

describe('createMailer', () => {
  it('prefers Resend when both transports are configured', () => {
    const env = loadEnv({ ...base, RESEND_API_KEY: 're_x', SMTP_URL: 'smtp://mail:25' });
    expect(createMailer(env).kind).toBe('resend');
  });

  it('uses SMTP when only SMTP_URL is set', () => {
    expect(createMailer(loadEnv({ ...base, SMTP_URL: 'smtp://mail:25' })).kind).toBe('smtp');
  });

  it('falls back to the console without a transport', () => {
    expect(createMailer(loadEnv(base)).kind).toBe('console');
  });
});

describe('resendMailer', () => {
  it('posts the message to the Resend API with the key as a bearer token', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"id":"1"}'));
    await resendMailer('re_key', 'Trackt <no-reply@trackt.test>', fetchImpl).send(message);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer re_key' });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: 'Trackt <no-reply@trackt.test>',
      to: ['vera@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
    });
  });

  it('throws when Resend rejects the message', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('domain not verified', { status: 403 }),
    );
    await expect(resendMailer('re_key', 'x@y.z', fetchImpl).send(message)).rejects.toThrow(
      /403 domain not verified/,
    );
  });
});

describe('consoleMailer', () => {
  it('writes the text body, which carries the code and link', async () => {
    const lines: string[] = [];
    await consoleMailer((line) => lines.push(line)).send(message);
    expect(lines.join('')).toContain('vera@example.com');
    expect(lines.join('')).toContain('Hi');
  });
});

describe('verification email', () => {
  it('picks the web locale cookie, then Accept-Language, then English', () => {
    expect(mailLocale(new Headers({ cookie: 'a=1; trackt_locale=fr' }))).toBe('fr');
    expect(mailLocale(new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }))).toBe('fr');
    expect(
      mailLocale(new Headers({ cookie: 'trackt_locale=en', 'accept-language': 'fr-FR' })),
    ).toBe('en');
    expect(mailLocale(undefined)).toBe('en');
  });

  it('escapes the link in the HTML body', () => {
    const { html, text } = verificationEmail({
      to: 'a@b.c',
      code: '123456',
      link: 'https://t.test/verify-email?email=a%40b.c&code=123456',
      locale: 'en',
    });
    expect(html).toContain('href="https://t.test/verify-email?email=a%40b.c&amp;code=123456"');
    expect(text).toContain('https://t.test/verify-email?email=a%40b.c&code=123456');
  });
});

describe('existing-account email', () => {
  it('carries no code and links to sign-in, in either language', () => {
    const en = existingAccountEmail({
      to: 'a@b.c',
      verified: true,
      link: 'https://t.test/login',
      locale: 'en',
    });
    expect(en.subject).toBe('You already have a Trackt account');
    expect(en.html).toContain('href="https://t.test/login"');
    expect(en.text).not.toMatch(/\d{6}/);

    const fr = existingAccountEmail({
      to: 'a@b.c',
      verified: false,
      link: 'https://t.test/login',
      locale: 'fr',
    });
    expect(fr.subject).toBe('Vous avez déjà un compte Trackt');
    expect(fr.text).toContain('nouveau code');
  });
});

import { describe, expect, it } from 'vitest';
import { isDisposableEmail } from '../src/disposable-email.js';

describe('isDisposableEmail', () => {
  it('refuses throwaway inboxes from the upstream blocklist', () => {
    expect(isDisposableEmail('a@mailinator.com')).toBe(true);
    expect(isDisposableEmail('a@yopmail.com')).toBe(true);
  });

  it('refuses on-demand relay aliases, subdomains included', () => {
    expect(isDisposableEmail('x1y2@mozmail.com')).toBe(true);
    expect(isDisposableEmail('alias@vera.mozmail.com')).toBe(true);
    expect(isDisposableEmail('quiet.fox@duck.com')).toBe(true);
    expect(isDisposableEmail('abc@privaterelay.appleid.com')).toBe(true);
    expect(isDisposableEmail('me@user.anonaddy.com')).toBe(true);
  });

  it('ignores case, surrounding space and a trailing dot', () => {
    expect(isDisposableEmail('A@MozMail.COM ')).toBe(true);
    expect(isDisposableEmail('a@duck.com.')).toBe(true);
  });

  it('accepts ordinary providers and anything that is not an address', () => {
    for (const email of ['a@gmail.com', 'a@proton.me', 'a@icloud.com', 'a@outlook.fr']) {
      expect(isDisposableEmail(email)).toBe(false);
    }
    expect(isDisposableEmail('not-an-email')).toBe(false);
    expect(isDisposableEmail('@mozmail.com')).toBe(false);
    expect(isDisposableEmail('a@notmozmail.com')).toBe(false);
  });
});

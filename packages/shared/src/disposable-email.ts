import { isDisposableEmailDomain } from 'disposable-email-domains-js';

/**
 * Forwarding services that mint an address per site. The upstream blocklist
 * covers throwaway inboxes only, and leaves these out on purpose.
 */
const RELAY_DOMAINS = new Set([
  '33mail.com',
  '8shield.net',
  'addy.io',
  'aleeas.com',
  'anonaddy.com',
  'anonaddy.me',
  'burnermail.io',
  'duck.com',
  'mozmail.com',
  'passfwd.com',
  'passinbox.com',
  'passmail.com',
  'passmail.net',
  'privaterelay.appleid.com',
  'simplelogin.co',
  'simplelogin.com',
  'slmail.me',
  'slmails.com',
]);

function isRelayDomain(domain: string): boolean {
  const parts = domain.split('.');
  // Subdomains count too: Firefox Relay and addy.io hand out `alias@user.mozmail.com`.
  for (let i = 0; i < parts.length - 1; i++) {
    if (RELAY_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

/** True for a throwaway inbox or an on-demand relay alias, which sign-up refuses. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '');
  if (!domain.includes('.')) return false;
  return isRelayDomain(domain) || isDisposableEmailDomain(domain);
}

import { describe, expect, it } from 'vitest';
import { authErrorKey } from '../src/auth-errors.js';

describe('authErrorKey', () => {
  it('maps better-auth codes to catalog keys', () => {
    expect(authErrorKey({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 'errors.signInFailed')).toBe(
      'errors.invalidCredentials',
    );
    expect(authErrorKey({ code: 'USERNAME_IS_ALREADY_TAKEN' }, 'errors.signUpFailed')).toBe(
      'errors.usernameTaken',
    );
    expect(authErrorKey({ code: 'OTP_EXPIRED' }, 'errors.verifyFailed')).toBe('errors.codeExpired');
  });

  it('falls back for codes it does not know, and for no error at all', () => {
    expect(authErrorKey({ code: 'SOMETHING_NEW' }, 'errors.signUpFailed')).toBe(
      'errors.signUpFailed',
    );
    expect(authErrorKey(null, 'errors.generic')).toBe('errors.generic');
  });
});

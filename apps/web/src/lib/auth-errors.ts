/**
 * better-auth messages are English, and the API is not localized. The UI maps
 * its codes to catalog keys and never renders the raw body inside French chrome.
 */
type AuthErrorKey =
  | 'errors.invalidCredentials'
  | 'errors.emailTaken'
  | 'errors.usernameTaken'
  | 'errors.invalidUsername'
  | 'errors.weakPassword'
  | 'errors.generic'
  | 'errors.signInFailed'
  | 'errors.signUpFailed';

export function authErrorKey(
  error: { code?: string | undefined; status?: number | undefined } | null,
  fallback: AuthErrorKey,
): AuthErrorKey {
  switch (error?.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'INVALID_EMAIL':
    case 'INVALID_PASSWORD':
      return 'errors.invalidCredentials';
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'errors.emailTaken';
    case 'USERNAME_IS_ALREADY_TAKEN':
    case 'USERNAME_ALREADY_TAKEN':
      return 'errors.usernameTaken';
    case 'INVALID_USERNAME':
      return 'errors.invalidUsername';
    case 'PASSWORD_TOO_SHORT':
      return 'errors.weakPassword';
    default:
      return fallback;
  }
}

/**
 * Why an import cannot run, in words a caller can act on: the CLI prints the
 * message, and the worker hands `kind` to the client so the wizard can say
 * "that profile is private" instead of "import failed".
 */
export type ImportErrorKind =
  /** A credential the source needs is missing — fix the instance's env. */
  | 'credential'
  /** The provider has no such user. */
  | 'not-found'
  /** The user exists but keeps their lists private. */
  | 'private'
  /** The credential was rejected. */
  | 'auth'
  | 'http'
  | 'malformed';

export class ImportError extends Error {
  constructor(
    message: string,
    readonly kind: ImportErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

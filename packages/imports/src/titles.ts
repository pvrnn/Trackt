/**
 * Lowercase, accent-stripped, punctuation collapsed. The only equality the
 * importer ever trusts for a title — used by the local fallback and by the
 * central-catalog lookup, so both agree on what "the same title" means.
 */
export function normaliseTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

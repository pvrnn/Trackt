/**
 * Scores are shown to one decimal place, but the separator is locale copy:
 * `8.5` in English, `8,5` in French. `toFixed(1)` hard-codes the dot.
 */
export function formatScore(value: number, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

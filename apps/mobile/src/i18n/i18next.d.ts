import type { en } from './locales/index.js';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    // The merged catalog, not `en.json`: surface fragments are part of the keys.
    resources: { translation: typeof en };
  }
}

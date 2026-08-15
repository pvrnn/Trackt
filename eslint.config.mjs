// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.output/**',
      '**/.tanstack/**',
      '**/.turbo/**',
      '**/routeTree.gen.ts',
      'packages/db/migrations/**',
      'docs/design/**',
      'apps/mobile/.expo/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // The rules-of-hooks check over the mobile app and the data layer it shares
  // with web. `@trackt/client` needs it most: `useIsAuthed()` is a hook reached
  // through an injected function, which is exactly the shape a conditional call
  // would hide in.
  //
  // Not `eslint-config-expo`, which the mobile plan called for: it pins
  // eslint-plugin-react 7.x, and that crashes on this repo's ESLint 10
  // (`contextOrFilename.getFilename is not a function`). Worth revisiting for
  // its import resolver and `.ios.tsx`/`.android.tsx` awareness once upstream
  // catches up.
  //
  // apps/web is deliberately out of scope here — v7 added opinionated rules
  // (`set-state-in-effect`) that its existing components trip, and widening the
  // net is a change to make on purpose, not as a side effect of scaffolding.
  {
    ...reactHooks.configs.flat.recommended,
    files: ['apps/mobile/**/*.{ts,tsx}', 'packages/client/src/*.ts'],
  },
);

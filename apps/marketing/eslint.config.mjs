import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  // `next lint` skips these on its own; a bare `npx eslint .` does not,
  // so after a build it lints the minified output and reports hundreds
  // of `require()` errors in code nobody wrote. Ignoring them here makes
  // the plain command mean the same thing as the scripted one.
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts'],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default eslintConfig;

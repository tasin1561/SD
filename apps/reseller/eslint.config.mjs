import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The (authed) route-group dir name contains parens which the
      // default rules don't like; Next route groups are intentional.
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default eslintConfig;

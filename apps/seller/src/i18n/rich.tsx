import { Fragment, type ReactNode } from 'react';

/**
 * Put React nodes (a `<Money/>`, a `<strong>`, a link) inside a translated
 * sentence: `Hello {name}` + `{ name: <b>Rina</b> }`. The same as
 * `richMessage` in `@skydrop/ui/app/i18n-client`, but with no `'use client'`
 * boundary so a SERVER component can call it too. Pass the UNFORMATTED
 * template (`t(key)` with no params leaves `{x}` intact); the translator
 * decides where the grammar wants each placeholder.
 */
export function richMessage(
  template: string,
  nodes: Readonly<Record<string, ReactNode>>,
): ReactNode {
  return template
    .split(/\{(\w+)\}/)
    .map((part, i) =>
      i % 2 === 1 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part,
    );
}

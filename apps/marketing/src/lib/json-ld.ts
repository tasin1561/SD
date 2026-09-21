import { PLACEHOLDER_VALUES } from '@/content/dummy';

/**
 * Serialise structured data — and REFUSE a placeholder inside it.
 *
 * The `Placeholder<string>` brand is still assignable to `string`, so the
 * type system cannot stop a `dummy()` value reaching a schema field. The
 * runtime registry can: this walks the object at build time (the page is
 * a server component under `output: 'export'`) and throws, so a fabricated
 * figure never ships as a machine-readable fact about the company.
 */
export function jsonLd(value: unknown): string {
  walk(value, '$');
  return JSON.stringify(value);
}

function walk(node: unknown, path: string): void {
  if (PLACEHOLDER_VALUES.has(node)) {
    throw new Error(
      `jsonLd: placeholder content at ${path} — replace the dummy() before publishing it as structured data`,
    );
  }
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, `${path}.${k}`);
  }
}

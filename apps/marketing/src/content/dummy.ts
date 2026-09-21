/**
 * `dummy()` marks a value the OWNER has not supplied yet.
 *
 * Every business-specific figure on the site — a stat, a rate, a hotline,
 * a testimonial — is a placeholder until it is replaced with a real one,
 * and a placeholder that looks like copy is a lie that ships. This wrapper
 * makes each one findable in two ways: `scripts/check-content.mjs` walks
 * the SOURCE for `dummy(` calls and lists them with their key, and the
 * runtime registry below lets `jsonLd()` refuse to publish one inside
 * structured data even when the type system cannot tell it from a string.
 *
 * TypeScript never inlines a call, so the scanner sees every use.
 */

declare const PLACEHOLDER: unique symbol;

/** Structurally a `T`; the brand is what lets a reader spot it in a type. */
export type Placeholder<T> = T & { readonly [PLACEHOLDER]?: true };

/** Every value ever passed through `dummy()` — read by `jsonLd()`. */
export const PLACEHOLDER_VALUES = new Set<unknown>();

export function dummy<T>(value: T): Placeholder<T> {
  PLACEHOLDER_VALUES.add(value);
  return value as Placeholder<T>;
}

/** True when this exact value (by reference for objects, by value for primitives) is a placeholder. */
export function isPlaceholder(value: unknown): boolean {
  return PLACEHOLDER_VALUES.has(value);
}

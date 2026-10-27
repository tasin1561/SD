/**
 * Excel's `sep=` hint line, shared by the catalog and order CSV importers.
 *
 * Excel splits a CSV on the Windows "List separator" setting, not on commas,
 * so on a machine where that is `;` a comma file opens entirely in column A.
 * Our templates therefore start with `sep=,`. The importers live in different
 * modules and each owns its own parser, so the logic sits here (a pure,
 * dependency-free helper) rather than being written twice: the emitter and the
 * skipper must never drift apart, or a downloaded template stops re-uploading.
 */

/** UTF-8 BOM: without it Excel decodes UTF-8 as ANSI and mojibakes names. */
export const CSV_BOM = '﻿';

/** Prefix for a template body: BOM, then the Excel hint for a comma file. */
export const CSV_TEMPLATE_PREFIX = `${CSV_BOM}sep=,\n`;

const HINT_LINE = /^sep=(.)\r?(?:\n|$)/i;

/**
 * Strip a BOM and a true first-line `sep=<char>` hint. Returns the remaining
 * text and, only when a hint was present, its delimiter. With no hint the
 * delimiter is left undefined so papaparse keeps auto-detecting (that is what
 * lets semicolon files from other machines parse today).
 */
export function stripCsvSeparatorHint(input: string): { text: string; delimiter?: string } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const m = HINT_LINE.exec(text);
  if (m === null || m[1] === undefined) return { text };
  return { text: text.slice(m[0].length), delimiter: m[1] };
}

/**
 * Code 128 (subset B) — the barcode a warehouse scanner expects.
 *
 * Written here rather than pulled in as a dependency because the
 * encoding is small, fixed and CHECKABLE: 107 published patterns, a
 * mod-103 checksum, and reference vectors anybody can verify against.
 * A library would be more code to audit than the thing it encodes.
 *
 * Subset B rather than C: C packs digit PAIRS and is denser, but an AWB
 * is not guaranteed numeric — a manual courier's docket can carry
 * letters — and a label that silently fails to encode is worse than one
 * a few millimetres wider.
 *
 * The output is BAR WIDTHS in modules, alternating bar/space, starting
 * with a bar. The caller decides how wide a module is in points, which
 * is what lets the same encoding print at label size or at A4.
 */

/**
 * The 107 symbol patterns. Index = the code value; 103/104/105 are the
 * three start codes and 106 is stop. Each string is six digits — the
 * widths of bar,space,bar,space,bar,space — summing to 11, except stop
 * which is seven digits and 13 modules.
 */
const PATTERNS: readonly string[] = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
];

const START_B = 104;
const STOP = 106;

/** Every character Code 128 subset B can carry: ASCII 32–126. */
export function isEncodableCode128B(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value);
}

/**
 * Encode to alternating bar/space widths, starting with a bar.
 *
 * Throws on an unencodable character rather than dropping it: a barcode
 * that scans as a DIFFERENT number than the one printed beside it is
 * the worst possible outcome — the parcel goes to the wrong place and
 * the label agrees with itself.
 */
export function encodeCode128B(value: string): number[] {
  if (!isEncodableCode128B(value)) {
    throw new Error(`CODE128_UNENCODABLE: ${JSON.stringify(value)}`);
  }

  const codes: number[] = [START_B];
  for (const ch of value) {
    codes.push(ch.charCodeAt(0) - 32);
  }

  // Mod-103 checksum: the start value plus each data value weighted by
  // its 1-based position.
  let sum = START_B;
  for (let i = 1; i < codes.length; i += 1) {
    sum += (codes[i] ?? 0) * i;
  }
  codes.push(sum % 103);
  codes.push(STOP);

  const widths: number[] = [];
  for (const code of codes) {
    const pattern = PATTERNS[code];
    if (pattern === undefined) throw new Error(`CODE128_BAD_SYMBOL: ${code}`);
    for (const d of pattern) widths.push(Number(d));
  }
  return widths;
}

/** Total width in modules — what the caller needs to fit it in a box. */
export function code128Modules(value: string): number {
  return encodeCode128B(value).reduce((n, w) => n + w, 0);
}

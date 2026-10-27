import { CATALOGS } from '@/i18n/catalog';

/**
 * Structural specs read a component's SOURCE for the sentence it must carry.
 * Since the English moved into the message catalogue, the sentence is no longer
 * in the .tsx — so the haystack is the source PLUS the English catalogue. The
 * spec keeps asserting the same words are on screen; where they are stored is
 * not what it was written to pin.
 */
export function withCatalogEnglish(src: string): string {
  return src + '\n' + Object.values(CATALOGS.en).join('\n');
}

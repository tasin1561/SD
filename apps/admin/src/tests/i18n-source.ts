import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The same idea for a spec in THIS suite that reads ANOTHER app's source
 * — several do, because an invariant about the seller console is often
 * only checkable from the side that would break it.
 *
 * `CATALOGS` above is admin's own, so it cannot see a sentence that now
 * lives in apps/seller's catalogue; the message files are read off disk
 * instead, which is what these specs already do with the components.
 * Both halves of each pair come along, so an English regex still only
 * matches English — a NEGATIVE assertion here cannot see the Bangla, and
 * where the forbidden wording matters it is pinned in both languages
 * explicitly (see WAL-2 in wallet-topup.test.ts).
 */
export function withAppCatalogue(src: string, app: string): string {
  const dir = join(__dirname, '..', '..', '..', app, 'src', 'i18n', 'messages');
  if (!existsSync(dir)) throw new Error(`No message catalogue for apps/${app} at ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  if (files.length === 0) throw new Error(`apps/${app}'s catalogue is empty at ${dir}`);
  return [src, ...files.map((f) => readFileSync(join(dir, f), 'utf8'))].join('\n');
}

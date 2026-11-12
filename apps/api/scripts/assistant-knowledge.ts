/**
 * Regenerates the assistant's committed knowledge indexes.
 *
 *   pnpm --filter @skydrop/api assistant:knowledge
 *
 * Run it whenever a `code: 'X'` is added to apps/api/src, a page is added
 * to a console, a console's page-access table or message catalogue
 * changes, the settings guide changes, or a docs/invariants file changes.
 * `assistant-knowledge-fresh.spec.ts` fails CI until you do.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../src/modules/assistant/knowledge/generator';

const root = join(__dirname, '../../..');
const out = join(__dirname, '../src/modules/assistant/knowledge/generated');
mkdirSync(out, { recursive: true });
for (const [file, body] of Object.entries(render(root))) {
  writeFileSync(join(out, file), body);
  console.info(`wrote ${file} (${body.length} bytes)`);
}

/**
 * One small JSON file per video, written by the seed and read by the flow.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * A few admin forms are addressed by UUID — a cycle count is recorded
 * per (variant, bin, batch), and so is a stock transfer — and those ids
 * are minted per box, so a flow cannot name them and no screen in the
 * console prints all three together. Until now every flow got its
 * handles from the PAGE, which is the right default and is why this did
 * not exist: a selector that reaches for what a person would reach for
 * is also the thing that breaks when the page does.
 *
 * It is NOT a back door for that. The rule stays: anything a VIEWER is
 * shown is found on screen. This carries only what the operator is
 * expected to arrive already holding — the numbers off a count sheet —
 * which is exactly what the narration says about them.
 *
 * Per stack, because `WORK_DIR` is (two agents film at once), and
 * gitignored with the rest of `out/`. Missing or stale is a loud
 * failure rather than a silent one: a flow that cannot read its fixture
 * says which seed writes it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { GENERATED_DIR } from './paths.mjs';

/*
  `GENERATED_DIR`, which the other filming stack's agent added the same
  afternoon for the same class of thing — a file a SEED writes because
  its contents are this box's ids. One place rather than two
  conventions; `fixtures/` next door stays committed and is the other
  kind, a file whose contents are narrated word for word.
*/
const DIR = GENERATED_DIR;

function fileFor(slug) {
  return path.join(DIR, `${slug}.json`);
}

export async function writeFixture(slug, data) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(fileFor(slug), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function readFixture(slug) {
  try {
    return JSON.parse(await fs.readFile(fileFor(slug), 'utf8'));
  } catch {
    throw new Error(
      `No fixture for "${slug}" at ${fileFor(slug)} — run ` +
        `\`TUT_STACK=${process.env.TUT_STACK ?? 'a'} node scripts/tutorials/seed-demo-data.mjs ${slug}\`, ` +
        'which is what writes it.',
    );
  }
}

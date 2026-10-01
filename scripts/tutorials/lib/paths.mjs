/** Where everything lives, in one place so no two scripts can disagree. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const TUTORIALS_DIR = path.resolve(here, '..');
export const REPO_ROOT = path.resolve(TUTORIALS_DIR, '..', '..');

/** Generated media. Gitignored — scripts are committed, mp4s are not. */
export const OUT_DIR = path.join(TUTORIALS_DIR, 'out');

/**
 * WHICH FILMING STACK's scratch directories these are.
 *
 * Two agents film at once (see `lib/stacks.mjs`), so the webm Playwright
 * flushed, the ffmpeg intermediates and the verification frames are
 * per-stack: stack `a` keeps the original unsuffixed layout, every other
 * stack gets its own. Without this, two agents who happened to film the
 * same slug would have one `record.mjs` wipe `out/raw/<slug>` while the
 * other's composer was reading it — and the composer would report a
 * missing marker, which reads as a sync bug rather than a collision.
 *
 * Read LAZILY from the environment rather than through
 * `resolveStack()`, on purpose: `flows.mjs` imports this file for
 * `TUTORIALS_DIR` alone, and making a path constant throw when
 * `TUT_STACK` is unset would take out `make-tutorials.sh`'s own "which
 * console does this slug need" lookup. The guard that actually matters —
 * refusing to seed the wrong database — lives in
 * `assertStackEnvironment`, where getting it wrong costs a world.
 */
const STACK_SUFFIX =
  process.env.TUT_STACK === undefined || process.env.TUT_STACK.trim().toLowerCase() === 'a'
    ? ''
    : `-${process.env.TUT_STACK.trim().toLowerCase()}`;

/**
 * SHARED between stacks, and that is the point: a clip is keyed on the
 * slug and the narration line, so two stacks filming different videos
 * never collide here, while a RE-take of a video another stack already
 * voiced costs nothing instead of buying the same sentence twice.
 */
export const AUDIO_DIR = path.join(OUT_DIR, 'audio');

/**
 * Fixtures a SEED writes, rather than ones the repository carries.
 *
 * Per stack, because what is in them is this stack's world: N5's video
 * uploads the courier's remittance export, and an export naming waybills
 * is an export naming waybills the simulator minted on THIS box, on this
 * run. A committed file cannot carry those, and a shared one would hand
 * the other agent's parcels to this agent's allocation.
 *
 * `fixtures/` next door stays committed and is the other kind: a file
 * whose CONTENTS are narrated word for word, which must move with the
 * words or not at all.
 */
export const GENERATED_DIR = path.join(OUT_DIR, `generated${STACK_SUFFIX}`);

export const RAW_DIR = path.join(OUT_DIR, `raw${STACK_SUFFIX}`);
export const WORK_DIR = path.join(OUT_DIR, `work${STACK_SUFFIX}`);
export const VERIFY_DIR = path.join(OUT_DIR, `verify${STACK_SUFFIX}`);

/** The recording canvas. 8 extra rows carry the sync marker and are cropped off. */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const MARKER_STRIP = 8;
export const CANVAS_HEIGHT = FRAME_HEIGHT + MARKER_STRIP;

/** Playwright records at 25fps; the marker reader samples at the same rate. */
export const FPS = 25;

/** Narration length window — clips outside it are flagged, not rejected. */
export const MIN_CLIP_SECONDS = 8;
export const MAX_CLIP_SECONDS = 15;

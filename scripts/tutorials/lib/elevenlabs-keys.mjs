/**
 * The ElevenLabs keys, and the rules for moving between them.
 *
 * The narration is billed per character against a monthly allowance, and
 * the allowance is smaller than the library. So there is more than one
 * account, and a run that exhausts the first one carries on against the
 * next rather than stopping half-way through a video.
 *
 * NOTHING HERE EVER PRINTS A KEY — not the key, not a prefix of it, not
 * its length. A key is referred to by its POSITION in the ring ("key 1",
 * "key 2"), which is enough to say which account paid for a clip and
 * carries nothing about the account itself. `redact()` is the backstop:
 * every message that leaves this module goes through it, so a key that
 * somehow reached an error string is replaced rather than logged.
 *
 * The classification is the load-bearing part. Rotating on the wrong
 * failure is how a transient wobble silently spends the second account's
 * credits, so:
 *
 *   EXHAUSTED  → this key is out of money. Rotate, retry the SAME clip.
 *   TRANSIENT  → the network or their side hiccuped. Retry the same key.
 *   FATAL      → anything we do not recognise. STOP, and do not touch
 *                another key.
 *
 * That last line is deliberate. An unrecognised failure looks exactly
 * like an exhausted one from the outside, and treating the two alike
 * would burn every key in the ring on one bad request.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'skydrop');
export const KEYS_FILE = path.join(CONFIG_DIR, 'elevenlabs-keys');
export const SINGLE_KEY_FILE = path.join(CONFIG_DIR, 'elevenlabs');

/**
 * Failure classes. A string union rather than an enum so the mock in
 * `test/key-rotation.test.mjs` can assert on it without importing types.
 * @typedef {'EXHAUSTED' | 'TRANSIENT' | 'FATAL'} FailureKind
 */

/**
 * The account has no credits left.
 *
 * Read off the LIVE API, not off the docs — the two disagree. Their
 * error reference says a permissions failure is a 403 `insufficient_
 * permissions`; the live API answers 401 with `status:
 * "missing_permissions"`. So this matches on the marker strings and
 * treats the HTTP code as a secondary signal, because the marker is what
 * has actually been observed coming back.
 */
const EXHAUSTED_MARKERS = new Set([
  'quota_exceeded',
  'insufficient_credits',
  'payment_required',
  'max_character_limit_exceeded',
]);

/** Their side, briefly. Retrying the same key is the whole fix. */
const TRANSIENT_MARKERS = new Set([
  'rate_limit_exceeded',
  'concurrent_limit_exceeded',
  'too_many_concurrent_requests',
  'too_many_requests',
  'system_busy',
  'internal_error',
  'service_unavailable',
]);

/**
 * Pull the marker strings out of an error body.
 *
 * `detail` is an object on every error this has met, but FastAPI also
 * emits it as a string and as an array of validation objects, so this
 * refuses to assume — an unreadable body yields no markers, which lands
 * the caller in FATAL, which is the safe direction.
 */
function markersIn(bodyText) {
  /** @type {string[]} */
  const found = [];
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return found;
  }
  const detail = parsed?.detail;
  const objects = Array.isArray(detail) ? detail : [detail];
  for (const d of objects) {
    if (d === null || typeof d !== 'object') continue;
    for (const field of ['status', 'code', 'type']) {
      if (typeof d[field] === 'string') found.push(d[field]);
    }
  }
  return found;
}

/**
 * What a failed request means for the ring.
 *
 * @param {number} httpStatus
 * @param {string} bodyText
 * @returns {FailureKind}
 */
export function classifyFailure(httpStatus, bodyText) {
  const markers = markersIn(bodyText);

  // The MARKER is asked first, and the status code second. A 429 whose
  // body says `quota_exceeded` is an exhausted account being reported
  // through a rate-limit code, and retrying it forever against the same
  // key is the failure this ordering prevents.
  if (markers.some((m) => EXHAUSTED_MARKERS.has(m))) return 'EXHAUSTED';
  if (markers.some((m) => TRANSIENT_MARKERS.has(m))) return 'TRANSIENT';

  if (httpStatus === 402) return 'EXHAUSTED';
  if (httpStatus === 429) return 'TRANSIENT';
  if (httpStatus >= 500) return 'TRANSIENT';

  // 401 lands HERE, not in EXHAUSTED. A 401 is ambiguous: it is what an
  // out-of-credit account returns AND what a key with the wrong scopes
  // returns (`missing_permissions`, seen live on this project's own
  // key). Only the marker tells them apart, and it was asked above — so
  // a 401 that got this far is a key problem, and rotating past it would
  // hide a misconfigured key behind a spent one.
  return 'FATAL';
}

/**
 * One key per line. Blank lines and `#` comments are skipped, so the
 * file can say which account is which without the note becoming a key.
 */
export function parseKeyList(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

async function readFileOrNull(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Every key available, in the order they will be spent.
 *
 * The LIST comes first, ahead of the single-key env var, and that order
 * is load-bearing: `make-tutorials.sh` exports `ELEVENLABS_API_KEY` from
 * the old single-key file, so an env-first precedence would quietly run
 * a two-key machine on one key and report a quota failure that was never
 * real.
 */
export async function readKeys() {
  const fromEnvList = process.env.ELEVENLABS_API_KEYS;
  if (fromEnvList !== undefined && fromEnvList.trim() !== '') {
    const keys = parseKeyList(fromEnvList.replaceAll(',', '\n'));
    if (keys.length > 0) return keys;
  }

  const listFile = await readFileOrNull(KEYS_FILE);
  if (listFile !== null) {
    const keys = parseKeyList(listFile);
    if (keys.length > 0) return keys;
  }

  const fromEnv = process.env.ELEVENLABS_API_KEY;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return [fromEnv.trim()];

  const single = await readFileOrNull(SINGLE_KEY_FILE);
  if (single !== null && single.trim() !== '') return [single.trim()];

  throw new Error(
    `No ElevenLabs key. Put one key per line in ${KEYS_FILE}, ` +
      `or a single key in ${SINGLE_KEY_FILE}, or set ELEVENLABS_API_KEYS.`,
  );
}

/** Thrown when every key in the ring is spent. Carries what is left to do. */
export class QuotaExhaustedError extends Error {
  /** @param {{ done: number, remaining: number, keys: number }} counts */
  constructor(counts) {
    super(
      `Every ElevenLabs key is out of quota. ${counts.done} clip(s) generated, ` +
        `${counts.remaining} still to do across ${counts.keys} key(s). ` +
        `Re-run the same command when an allowance resets — the per-clip manifest ` +
        `means nothing already paid for is bought again.`,
    );
    this.name = 'QuotaExhaustedError';
    this.counts = counts;
  }
}

/**
 * The keys, and which one is being spent.
 *
 * Exhaustion is one-way within a run: a key that answered `quota_
 * exceeded` will answer it again a minute later, so it is retired rather
 * than re-tried (the same reasoning as CUR-13 — a refusal is an opinion,
 * and it will be the same opinion tomorrow).
 */
export class KeyRing {
  /** @param {string[]} keys */
  constructor(keys) {
    if (keys.length === 0) throw new Error('KeyRing needs at least one key');
    this.#keys = [...keys];
    this.#index = 0;
    this.#spent = new Set();
  }

  #keys;
  #index;
  #spent;

  /** How many keys the ring holds. */
  get size() {
    return this.#keys.length;
  }

  /** 1-based, and the ONLY way a key is ever named in output. */
  get position() {
    return this.#index + 1;
  }

  /** The key to use now. */
  get current() {
    return this.#keys[this.#index];
  }

  /** Positions retired this run, for the report. */
  get spentPositions() {
    return [...this.#spent].map((i) => i + 1).sort((a, b) => a - b);
  }

  /** Every key, for the pre-flight budget and the voice check only. */
  get all() {
    return this.#keys.map((key, i) => ({ position: i + 1, key }));
  }

  /**
   * Retire the current key and move to the next unspent one.
   * @returns {boolean} false when the ring is empty.
   */
  rotate() {
    this.#spent.add(this.#index);
    for (let i = 0; i < this.#keys.length; i += 1) {
      if (!this.#spent.has(i)) {
        this.#index = i;
        return true;
      }
    }
    return false;
  }

  /**
   * Replace any key that appears in `text` with a placeholder.
   *
   * Nothing in this pipeline deliberately puts a key in a message, so
   * this should never fire. It exists because "should never" is not a
   * property anybody can check by reading, and a key logged once is a
   * key that has to be rotated.
   */
  redact(text) {
    let out = String(text);
    for (const [i, key] of this.#keys.entries()) {
      if (key.length >= 8) out = out.replaceAll(key, `«key ${i + 1} redacted»`);
    }
    return out;
  }
}

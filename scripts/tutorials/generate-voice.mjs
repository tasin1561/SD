/**
 * Narration → mp3, one clip per step, plus the MEASURED duration of each.
 *
 * The measured duration is the load-bearing output. The recorder holds
 * each scene for at least that long, and the composer retimes the video
 * to it — so a guess would desync the whole video. It comes from ffprobe
 * reading the file that was actually written, never from an estimate of
 * how long the words ought to take.
 *
 * Clips are CACHED by a hash of (text + voice + model + settings): a
 * re-run regenerates only the lines you changed, which keeps a re-take
 * from spending credits on nine identical clips.
 *
 * KEYS. There is more than one ElevenLabs account, because one month's
 * allowance is smaller than one section of the library. The ring, the
 * rotation rule and the reason a key is never printed are all in
 * `lib/elevenlabs-keys.mjs`. What lives here is when the ring is asked:
 * a budget check BEFORE the first clip is bought, and a rotation on the
 * clip that failed rather than on the next one.
 *
 *   node scripts/tutorials/generate-voice.mjs [slug]
 *   node scripts/tutorials/generate-voice.mjs --quota       # spend nothing
 *   node scripts/tutorials/generate-voice.mjs --voice-check # spend nothing
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { VIDEOS, videoBySlug } from './narration.mjs';
import { AUDIO_DIR, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from './lib/paths.mjs';
import { assertReady, language, sayFor } from './lib/languages.mjs';
import {
  KeyRing,
  QuotaExhaustedError,
  balanceFromRefusal,
  classifyFailure,
  readKeys,
} from './lib/elevenlabs-keys.mjs';

const run = promisify(execFile);

const API = 'https://api.elevenlabs.io/v1';
export const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // "Sarah"
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.55, similarity_boost: 0.75, style: 0.15, speed: 0.9 };

/** A transient failure is retried on the SAME key, this many times, backing off. */
const TRANSIENT_ATTEMPTS = 4;
const TRANSIENT_BACKOFF_MS = [2000, 5000, 12000];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cache key — every input that changes the audio is in it.
 *
 * `lang` defaults to English and English resolves to the ORIGINAL voice
 * and model, so the key an existing clip was cached under is reproduced
 * byte for byte. That is load-bearing: the 87 finished videos represent
 * ~199,000 characters already paid for, and a changed key re-buys every
 * one of them silently — no error, just a bill.
 */
function fingerprint(text, lang = language('en')) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        text,
        VOICE_ID: lang.voice,
        MODEL_ID: lang.model,
        VOICE_SETTINGS,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

/** Seconds, read off the file itself. */
export async function probeDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe gave no usable duration for ${file}: "${stdout.trim()}"`);
  }
  return seconds;
}

/**
 * What one key has left.
 *
 * `character_limit − character_count`. UNKNOWN is a first-class answer,
 * not an error: a key scoped to text-to-speech alone cannot read
 * `/user/subscription` at all (this project's own key answers 401
 * `missing_permissions` there while synthesising perfectly), and
 * refusing to film over a missing scope would be the tail wagging the
 * dog. The caller decides what to do with not knowing — see
 * `budgetFor`.
 */
export async function remainingCredits(key, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${API}/user/subscription`, { headers: { 'xi-api-key': key } });
  } catch (e) {
    return { known: false, reason: `could not reach ElevenLabs (${e.message})` };
  }
  if (!res.ok) {
    const body = await res.text();
    const why = body.includes('missing_permissions')
      ? 'the key is not scoped for user_read'
      : `HTTP ${res.status}`;
    return { known: false, reason: why };
  }
  const sub = await res.json();
  const limit = sub.character_limit;
  const used = sub.character_count;
  if (typeof limit !== 'number' || typeof used !== 'number') {
    return { known: false, reason: 'the subscription response carried no character counts' };
  }
  return { known: true, remaining: limit - used, limit, used, tier: sub.tier ?? null };
}

/**
 * The voice, as THIS key's account sees it.
 *
 * `EXAVITQu4vr4xnSDxMaL` is a stock voice and should be the same person
 * on every account — but an account can clone or customise over a voice
 * id, and if one of them has, the library changes narrator half way
 * through and nobody finds out until a viewer does. So it is checked
 * rather than assumed. UNKNOWN again is its own answer: the check needs
 * `voices_read`, which a text-to-speech-only key does not carry.
 */
export async function voiceIdentity(key, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(`${API}/voices/${VOICE_ID}`, { headers: { 'xi-api-key': key } });
  } catch (e) {
    return { known: false, reason: `could not reach ElevenLabs (${e.message})` };
  }
  if (!res.ok) {
    const body = await res.text();
    const why = body.includes('missing_permissions')
      ? 'the key is not scoped for voices_read'
      : `HTTP ${res.status}`;
    return { known: false, reason: why };
  }
  const v = await res.json();
  return {
    known: true,
    name: v.name ?? null,
    category: v.category ?? null,
    settings: v.settings ?? null,
  };
}

/**
 * Refuse to film if the accounts do not agree about who is speaking.
 *
 * WITH ONE KEY THIS CANNOT FAIL, and that is correct rather than a
 * weakness: a single account cannot disagree with itself, so there is
 * nothing to compare and nothing at risk. The check has teeth only from
 * the second key onward — which is also the moment the risk appears.
 *
 * With two or more keys an UNVERIFIABLE answer is treated as a stop,
 * not a shrug. The whole point is that a mid-library narrator change is
 * invisible; "we could not check" and "it is fine" are the same picture
 * from here, and only one of them is safe to act on.
 */
export async function assertSameVoice(ring, { fetchImpl = fetch, log = console.log } = {}) {
  const seen = [];
  for (const { position, key } of ring.all) {
    const id = await voiceIdentity(key, { fetchImpl });
    seen.push({ position, ...id });
    log(
      id.known
        ? `  · key ${position}: "${id.name}" (${id.category})`
        : `  · key ${position}: not readable — ${id.reason}`,
    );
  }

  if (ring.size === 1) {
    const only = seen[0];
    if (!only.known) {
      log('  one key, so there is nothing to compare — the check is moot, not skipped.');
    }
    return { agreed: true, compared: false, voices: seen };
  }

  const unreadable = seen.filter((s) => !s.known);
  if (unreadable.length > 0) {
    throw new Error(
      `Cannot confirm the voice is the same on every account: ` +
        `${unreadable.map((u) => `key ${u.position} (${u.reason})`).join(', ')}. ` +
        `Grant those keys voices_read, or film with one key. ` +
        `A narrator that changes mid-library is invisible until somebody watches it.`,
    );
  }

  const shape = (s) => JSON.stringify({ name: s.name, category: s.category, settings: s.settings });
  const first = shape(seen[0]);
  const differing = seen.filter((s) => shape(s) !== first);
  if (differing.length > 0) {
    throw new Error(
      `Voice ${VOICE_ID} is NOT the same on every account — ` +
        `key 1 has "${seen[0].name}" (${seen[0].category}) but ` +
        `${differing.map((d) => `key ${d.position} has "${d.name}" (${d.category})`).join(', ')}. ` +
        `Filming would change narrator part way through the library.`,
    );
  }

  log(`  the same voice on all ${ring.size} keys.`);
  return { agreed: true, compared: true, voices: seen };
}

/**
 * Buy one clip, moving through the ring as accounts run out.
 *
 * The rotation retries THE SAME CLIP on the next key. Anything else
 * would leave a hole in the middle of a video at exactly the moment the
 * run looked like it had recovered.
 */
export async function synthesise(
  ring,
  text,
  outFile,
  { fetchImpl = fetch, sleep = wait, lang = language('en') } = {},
) {
  for (;;) {
    let transientAttempts = 0;

    for (;;) {
      let res;
      try {
        res = await fetchImpl(`${API}/text-to-speech/${lang.voice}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ring.current,
            'content-type': 'application/json',
            accept: 'audio/mpeg',
          },
          body: JSON.stringify({ text, model_id: lang.model, voice_settings: VOICE_SETTINGS }),
        });
      } catch (e) {
        // A thrown fetch is the network, never the account.
        transientAttempts += 1;
        if (transientAttempts >= TRANSIENT_ATTEMPTS) {
          throw new Error(
            ring.redact(`ElevenLabs unreachable after ${transientAttempts} tries: ${e.message}`),
          );
        }
        await sleep(TRANSIENT_BACKOFF_MS[transientAttempts - 1] ?? 12000);
        continue;
      }

      if (res.ok) {
        await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
        return { keyPosition: ring.position };
      }

      // Deliberately does not echo the request headers — the key is in
      // them — and everything that IS echoed goes through `redact`.
      const body = await res.text();
      const kind = classifyFailure(res.status, body);

      if (kind === 'TRANSIENT') {
        transientAttempts += 1;
        if (transientAttempts >= TRANSIENT_ATTEMPTS) {
          throw new Error(
            ring.redact(
              `ElevenLabs kept failing on key ${ring.position} after ` +
                `${transientAttempts} tries — ${res.status}: ${body.slice(0, 300)}`,
            ),
          );
        }
        await sleep(TRANSIENT_BACKOFF_MS[transientAttempts - 1] ?? 12000);
        continue;
      }

      if (kind === 'EXHAUSTED') {
        // The refusal states the balance, and it is the only balance a
        // text-to-speech-scoped key can report. Free, and it says whether
        // waiting for the monthly reset is the answer.
        const left = balanceFromRefusal(body);
        const detail =
          left === null || left.remaining === null
            ? ''
            : ` (${left.remaining.toLocaleString('en-IN')} credits left` +
              (left.required === null
                ? ''
                : `, ${left.required.toLocaleString('en-IN')} needed for this line`) +
              ')';
        console.log(`    key ${ring.position} is out of quota${detail} — moving on`);
        if (!ring.rotate())
          throw new QuotaExhaustedError({ done: 0, remaining: 0, keys: ring.size });
        break; // same clip, next key
      }

      throw new Error(ring.redact(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`));
    }
  }
}

/**
 * What this run will cost, and whether the ring can pay for it.
 *
 * Asked BEFORE the first clip, because finding out half way through
 * leaves a video with a gap in it and a manifest that has to be reasoned
 * about. It refuses only when EVERY key's balance is known and the total
 * is short — a partially-unknown ring warns and goes ahead, since the
 * alternative is a missing scope blocking all production.
 */
export async function budgetFor(ring, characters, { fetchImpl = fetch, log = console.log } = {}) {
  const balances = [];
  for (const { position, key } of ring.all) {
    balances.push({ position, ...(await remainingCredits(key, { fetchImpl })) });
  }

  const known = balances.filter((b) => b.known);
  const total = known.reduce((a, b) => a + b.remaining, 0);
  const allKnown = known.length === balances.length;

  for (const b of balances) {
    log(
      b.known
        ? `  · key ${b.position}: ${b.remaining.toLocaleString('en-IN')} of ${b.limit.toLocaleString('en-IN')} credits left`
        : `  · key ${b.position}: balance unknown — ${b.reason}`,
    );
  }
  log(`  this run needs ${characters.toLocaleString('en-IN')} credits of new narration.`);

  if (allKnown && total < characters) {
    throw new Error(
      `Not enough credits: ${total.toLocaleString('en-IN')} left across ${ring.size} key(s), ` +
        `${characters.toLocaleString('en-IN')} needed. Nothing has been spent. ` +
        `Generate a shorter video, or wait for an allowance to reset.`,
    );
  }
  if (!allKnown) {
    log('  not every balance is readable, so this run may still stop part way — it is resumable.');
  }
  return { balances, total, allKnown, characters };
}

export async function voiceFor(
  video,
  { adopt = false, fetchImpl = fetch, ring = null, lang = language('en') } = {},
) {
  assertReady(lang);
  const keyRing = ring ?? new KeyRing(await readKeys());
  // Each language keeps its own directory — `<slug>` for English,
  // `<slug>-bn`, `<slug>-hi` for the others — so one language's clips and
  // manifest can never be mistaken for another's, and re-cutting Hindi
  // cannot touch English audio that is already paid for.
  const dir = path.join(AUDIO_DIR, `${video.slug}${lang.suffix}`);
  await fs.mkdir(dir, { recursive: true });

  const manifestFile = path.join(dir, 'clips.json');
  /** @type {Record<string, { fingerprint: string, seconds: number, file: string }>} */
  let cached = {};
  try {
    cached = JSON.parse(await fs.readFile(manifestFile, 'utf8')).clips ?? {};
  } catch {
    /* first run */
  }

  // Work out what is actually going to be BOUGHT before asking whether
  // there is money for it: a re-take of one line must not be refused for
  // want of the whole video's credits.
  // The text THIS language speaks. A step with no translation is a hole
  // in the video, so it is refused here rather than filmed silent.
  const untranslated = video.steps.filter((step) => sayFor(step, lang) === null);
  if (untranslated.length > 0) {
    throw new Error(
      `${video.slug}: ${lang.label} is missing "${lang.field}" on ${untranslated.length} step(s): ` +
        `${untranslated.map((s) => s.id).join(', ')}. Translate them before generating — a step ` +
        `with no line records as a silent scene, which only watching the finished video reveals.`,
    );
  }

  const toBuy = [];
  for (const step of video.steps) {
    const fp = fingerprint(sayFor(step, lang), lang);
    const file = path.join(dir, `${step.id}.mp3`);
    const hit = cached[step.id];
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);
    const reusable =
      (hit !== undefined && hit.fingerprint === fp && exists) ||
      (hit === undefined && exists && adopt);
    if (!reusable) toBuy.push(step);
  }
  if (toBuy.length > 0) {
    await budgetFor(
      keyRing,
      toBuy.reduce((a, s) => a + sayFor(s, lang).length, 0),
      { fetchImpl },
    );
  }

  const clips = {};
  let bought = 0;
  for (const [index, step] of video.steps.entries()) {
    const fp = fingerprint(sayFor(step, lang), lang);
    const file = path.join(dir, `${step.id}.mp3`);
    const hit = cached[step.id];
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);

    if (hit !== undefined && hit.fingerprint === fp && exists) {
      clips[step.id] = { fingerprint: fp, seconds: hit.seconds, file };
      console.log(`  · ${step.id.padEnd(16)} ${hit.seconds.toFixed(2)}s (cached)`);
      await writeManifest(manifestFile, video.slug, clips);
      continue;
    }

    // ADOPTION. An mp3 with no manifest entry is audio that was paid for
    // and then orphaned — which is exactly what a failed run used to
    // leave behind, before the manifest was written per clip. Its
    // duration is measurable; what CANNOT be checked is that the words
    // in it are still the words above, so this is opt-in and says so
    // every time. Without it the only way back is to buy the clip again.
    if (hit === undefined && exists && adopt) {
      const seconds = await probeDuration(file);
      clips[step.id] = { fingerprint: fp, seconds, file };
      console.log(
        `  · ${step.id.padEnd(16)} ${seconds.toFixed(2)}s (ADOPTED — unverified against the text)`,
      );
      await writeManifest(manifestFile, video.slug, clips);
      continue;
    }

    try {
      const { keyPosition } = await synthesise(keyRing, sayFor(step, lang), file, {
        fetchImpl,
        lang,
      });
      bought += 1;
      const seconds = await probeDuration(file);
      clips[step.id] = { fingerprint: fp, seconds, file };

      // WRITTEN PER CLIP, not once at the end. The manifest is what makes
      // a clip re-usable — a clip whose duration and fingerprint were
      // never recorded is regenerated on the next run, and regenerating
      // costs credits. Writing it only after the whole loop meant a run
      // that died on its last line threw away every clip it had just paid
      // for, which is how ten of them were lost and this was found.
      await writeManifest(manifestFile, video.slug, clips);

      const flag =
        seconds < MIN_CLIP_SECONDS
          ? '  ← SHORT, under the 8s floor'
          : seconds > MAX_CLIP_SECONDS
            ? '  ← LONG, over the 15s ceiling'
            : '';
      console.log(`  · ${step.id.padEnd(16)} ${seconds.toFixed(2)}s  [key ${keyPosition}]${flag}`);
    } catch (e) {
      // Stopping CLEANLY is the requirement: the manifest already holds
      // every clip bought so far, so the same command finishes the job
      // when an allowance resets.
      if (e instanceof QuotaExhaustedError) {
        throw new QuotaExhaustedError({
          done: index,
          remaining: video.steps.length - index,
          keys: keyRing.size,
        });
      }
      throw e;
    }
  }

  await writeManifest(manifestFile, video.slug, clips);
  return { clips, bought, keysSpent: keyRing.spentPositions, lastKey: keyRing.position };
}

/** The manifest, rewritten whole. Small enough that atomicity is not worth the temp file. */
async function writeManifest(manifestFile, slug, clips) {
  await fs.writeFile(manifestFile, `${JSON.stringify({ slug, clips }, null, 2)}\n`);
}

/** Read a previously generated manifest — the recorder and composer use this. */
/**
 * The clips a take plays, for ONE language.
 *
 * `lang` is a `LANGUAGES` entry, not a code, because the suffix and the
 * voice travel together — reading `<slug>-bn` while believing it is
 * English is a video whose narration is in the wrong language and whose
 * scene lengths are all wrong, and nothing about it fails.
 */
export async function loadClips(slug, lang = language('en')) {
  const file = path.join(AUDIO_DIR, `${slug}${lang.suffix}`, 'clips.json');
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  return parsed.clips;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  // `--adopt` takes mp3s that are on disk with no manifest entry and
  // records them rather than buying them again. See the adoption branch.
  const adopt = args.includes('--adopt');
  const ring = new KeyRing(await readKeys());

  if (args.includes('--quota')) {
    console.log(`\n${ring.size} key(s):`);
    for (const { position, key } of ring.all) {
      const q = await remainingCredits(key);
      console.log(
        q.known
          ? `  · key ${position}: ${q.remaining.toLocaleString('en-IN')} of ${q.limit.toLocaleString('en-IN')} left (${q.tier})`
          : `  · key ${position}: unknown — ${q.reason}`,
      );
    }
  } else if (args.includes('--voice-check')) {
    console.log(`\nVoice ${VOICE_ID} across ${ring.size} key(s):`);
    await assertSameVoice(ring);
  } else {
    // `--lang=bn`. Absent means English, so every command that already
    // worked keeps producing the same English audio from the cache.
    const langArg = args.find((a) => a.startsWith('--lang='));
    const lang = assertReady(language(langArg?.slice('--lang='.length) ?? 'en'));
    const named = args.find((a) => !a.startsWith('--'));
    const wanted = named === undefined ? VIDEOS : [videoBySlug(named)];
    // Checked ONCE for the whole run, not per video: it is a property of
    // the accounts, and asking per video would be several free calls
    // saying the same thing.
    console.log(`\nVoice ${VOICE_ID} across ${ring.size} key(s):`);
    await assertSameVoice(ring);
    for (const video of wanted) {
      console.log(`\n${video.title} (${video.slug}) — ${lang.label}`);
      const { clips, bought, lastKey } = await voiceFor(video, { adopt, ring, lang });
      const total = Object.values(clips).reduce((a, c) => a + c.seconds, 0);
      console.log(
        `  total narration ${total.toFixed(1)}s across ${Object.keys(clips).length} clips ` +
          `(${bought} bought this run, on key ${lastKey})`,
      );
    }
  }
}

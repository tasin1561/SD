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
 * The API key is read from ~/.config/skydrop/elevenlabs or the
 * ELEVENLABS_API_KEY env var, and is never printed.
 *
 *   node scripts/tutorials/generate-voice.mjs [slug]
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VIDEOS, videoBySlug } from './narration.mjs';
import { AUDIO_DIR, MIN_CLIP_SECONDS, MAX_CLIP_SECONDS } from './lib/paths.mjs';

const run = promisify(execFile);

const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // "Sarah"
const MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = { stability: 0.55, similarity_boost: 0.75, style: 0.15, speed: 0.9 };

async function apiKey() {
  const fromEnv = process.env.ELEVENLABS_API_KEY;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  const file = path.join(os.homedir(), '.config', 'skydrop', 'elevenlabs');
  try {
    const key = (await fs.readFile(file, 'utf8')).trim();
    if (key !== '') return key;
  } catch {
    /* fall through to the error below */
  }
  throw new Error(`No ElevenLabs key: set ELEVENLABS_API_KEY or put it in ${file}`);
}

/** Cache key — every input that changes the audio is in it. */
function fingerprint(text) {
  return createHash('sha256')
    .update(JSON.stringify({ text, VOICE_ID, MODEL_ID, VOICE_SETTINGS }))
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

async function synthesise(key, text, outFile) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    // Deliberately does not echo the request headers — the key is in them.
    throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
}

export async function voiceFor(video) {
  const key = await apiKey();
  const dir = path.join(AUDIO_DIR, video.slug);
  await fs.mkdir(dir, { recursive: true });

  const manifestFile = path.join(dir, 'clips.json');
  /** @type {Record<string, { fingerprint: string, seconds: number, file: string }>} */
  let cached = {};
  try {
    cached = JSON.parse(await fs.readFile(manifestFile, 'utf8')).clips ?? {};
  } catch {
    /* first run */
  }

  const clips = {};
  for (const step of video.steps) {
    const fp = fingerprint(step.say);
    const file = path.join(dir, `${step.id}.mp3`);
    const hit = cached[step.id];
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);

    if (hit !== undefined && hit.fingerprint === fp && exists) {
      clips[step.id] = { fingerprint: fp, seconds: hit.seconds, file };
      console.log(`  · ${step.id.padEnd(16)} ${hit.seconds.toFixed(2)}s (cached)`);
      continue;
    }

    await synthesise(key, step.say, file);
    const seconds = await probeDuration(file);
    clips[step.id] = { fingerprint: fp, seconds, file };

    const flag =
      seconds < MIN_CLIP_SECONDS
        ? '  ← SHORT, under the 8s floor'
        : seconds > MAX_CLIP_SECONDS
          ? '  ← LONG, over the 15s ceiling'
          : '';
    console.log(`  · ${step.id.padEnd(16)} ${seconds.toFixed(2)}s${flag}`);
  }

  await fs.writeFile(manifestFile, `${JSON.stringify({ slug: video.slug, clips }, null, 2)}\n`);
  return clips;
}

/** Read a previously generated manifest — the recorder and composer use this. */
export async function loadClips(slug) {
  const file = path.join(AUDIO_DIR, slug, 'clips.json');
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  return parsed.clips;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wanted = process.argv[2] === undefined ? VIDEOS : [videoBySlug(process.argv[2])];
  for (const video of wanted) {
    console.log(`\n${video.title} (${video.slug})`);
    const clips = await voiceFor(video);
    const total = Object.values(clips).reduce((a, c) => a + c.seconds, 0);
    console.log(`  total narration ${total.toFixed(1)}s across ${Object.keys(clips).length} clips`);
  }
}

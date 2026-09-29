/**
 * Prove the finished file is what it claims to be, on the two things
 * that can silently be wrong.
 *
 * 1. PICTURE. Grab a frame a little way into every scene and save it
 *    next to the line that is being spoken over it. Retiming is exactly
 *    the kind of arithmetic that can be off by one segment and still
 *    produce a smooth, plausible video, and the only way to know the
 *    picture matches the words is to look.
 *
 * 2. SOUND. ffmpeg's `silencedetect` reports where speech starts and
 *    stops. Each detected run of sound must begin inside its own scene's
 *    window — if narration has slipped into the neighbouring step, the
 *    starts drift out of their windows and this says which one first.
 *
 * Exits non-zero when a voice line starts outside its scene, so it can
 * gate a re-take. The frames are for a person; the report names them.
 *
 *   node scripts/tutorials/verify.mjs <slug>
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { videoBySlug } from './narration.mjs';
import { VERIFY_DIR, WORK_DIR } from './lib/paths.mjs';

const run = promisify(execFile);

/** Noise floor: the narration is loud, the video is silent between lines. */
const SILENCE_DB = -40;
const SILENCE_MIN = 0.35;

function silenceRuns(file) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN}`,
      '-f',
      'null',
      '-',
    ]);
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', () => {
      const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
      const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
      resolve({ starts, ends, raw: stderr });
    });
  });
}

export async function verify(slug) {
  const video = videoBySlug(slug);
  const timeline = JSON.parse(
    await fs.readFile(path.join(WORK_DIR, slug, 'timeline.json'), 'utf8'),
  );
  const frameDir = path.join(VERIFY_DIR, slug);
  await fs.rm(frameDir, { recursive: true, force: true });
  await fs.mkdir(frameDir, { recursive: true });

  // ── Picture ─────────────────────────────────────────────────────────
  // 1.2s in, not at the boundary itself: the boundary frame can land in
  // a fade, and a black frame proves nothing either way.
  const frames = [];
  for (const [i, scene] of timeline.scenes.entries()) {
    const at = scene.start + Math.min(1.2, scene.end - scene.start - 0.2);
    const file = path.join(frameDir, `${String(i + 1).padStart(2, '0')}-${scene.id}.png`);
    await run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      at.toFixed(3),
      '-i',
      timeline.outFile,
      '-frames:v',
      '1',
      '-vf',
      'scale=960:-1',
      file,
    ]);
    frames.push({ id: scene.id, at, file, say: video.steps.find((s) => s.id === scene.id).say });
  }

  // ── Sound ───────────────────────────────────────────────────────────
  // A "voice start" is the end of a silence, plus the very beginning if
  // the file does not open silent.
  const { starts, ends, raw } = await silenceRuns(timeline.outFile);
  const voiceStarts = [...ends];
  if (starts.length > 0 && starts[0] > 0.05) voiceStarts.unshift(0);
  voiceStarts.sort((a, b) => a - b);

  const checks = timeline.scenes.map((scene) => {
    // The clip is placed AT the scene start; the tail is silence at the
    // end, so the voice must begin in the scene's first moments.
    const lo = scene.start - 0.35;
    const hi = scene.start + 1.2;
    const hit = voiceStarts.find((t) => t >= lo && t <= hi);
    return {
      id: scene.id,
      expected: scene.start,
      detected: hit ?? null,
      offset: hit === undefined ? null : hit - scene.start,
      ok: hit !== undefined,
    };
  });

  const report = {
    slug,
    outFile: timeline.outFile,
    drift: timeline.drift,
    frames,
    checks,
    voiceStarts,
  };
  await fs.writeFile(
    path.join(frameDir, 'report.json'),
    `${JSON.stringify({ ...report, silencedetect: raw.split('\n').filter((l) => l.includes('silence_')) }, null, 2)}\n`,
  );

  console.log(`\n  ${slug} — ${timeline.scenes.length} scenes`);
  console.log(`  drift ${timeline.drift.toFixed(4)}x`);
  for (const c of checks) {
    const mark = c.ok ? 'ok  ' : 'MISS';
    const off = c.offset === null ? '     —' : `${c.offset >= 0 ? '+' : ''}${c.offset.toFixed(2)}s`;
    console.log(`  ${mark} ${c.id.padEnd(16)} voice at ${off} of its scene start`);
  }
  console.log(`  frames → ${frameDir}`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2];
  if (slug === undefined) throw new Error('usage: node scripts/tutorials/verify.mjs <slug>');
  const report = await verify(slug);
  const bad = report.checks.filter((c) => !c.ok);
  if (bad.length > 0) {
    console.error(
      `\n  ${bad.length} scene(s) have no voice at their start: ${bad.map((b) => b.id).join(', ')}`,
    );
    process.exitCode = 1;
  }
}

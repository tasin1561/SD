/**
 * Retime the recording to the narration and render the finished video.
 *
 * The problem this solves: Playwright's video clock runs slow against
 * wall time, and not uniformly — so a scene the recorder held open for
 * 11.5 real seconds may occupy 9 seconds of the file. Placing narration
 * at the offsets the recorder measured would therefore drift further out
 * with every scene.
 *
 * So: find each scene's REAL start in the file from its corner marker
 * (lib/markers.mjs), then RETIME each segment — split, trim, `setpts` —
 * so its picture lasts exactly as long as its narration plus the tail.
 * After that the two clocks agree by construction, and each clip is
 * placed with `adelay` at the cumulative intended start.
 *
 * The marker strip is cropped away in the same pass, so it never reaches
 * a viewer.
 *
 *   node scripts/tutorials/compose.mjs <slug>
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SCENE_TAIL_SECONDS, videoBySlug } from './narration.mjs';
import { loadClips } from './generate-voice.mjs';
import { assertReady, language } from './lib/languages.mjs';
import { findSceneStarts, readMarkerTrack } from './lib/markers.mjs';
import { cardFilter, INTRO_SECONDS, OUTRO_SECONDS } from './lib/title-card.mjs';
import {
  FPS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  MARKER_STRIP,
  OUT_DIR,
  RAW_DIR,
  WORK_DIR,
} from './lib/paths.mjs';

const run = promisify(execFile);

/** ffmpeg is chatty on stderr even when it succeeds; only a non-zero exit is a failure. */
function ffmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
    let stderr = '';
    proc.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} failed (${code}):\n${stderr.slice(0, 2000)}`));
    });
  });
}

async function duration(file) {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  return Number(stdout.trim());
}

export async function compose(slug, { lang = language('en') } = {}) {
  const video = videoBySlug(slug);
  // Raw frames, clips and scratch all carry the language: the takes are
  // different recordings of different lengths, and mixing one take's
  // pictures with another's timings produces a video that renders
  // cleanly and is wrong throughout.
  const rawDir = path.join(RAW_DIR, `${slug}${lang.suffix}`);
  const manifest = JSON.parse(await fs.readFile(path.join(rawDir, 'scenes.json'), 'utf8'));
  const clips = await loadClips(slug, lang);
  const work = path.join(WORK_DIR, `${slug}${lang.suffix}`);
  await fs.rm(work, { recursive: true, force: true });
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const source = manifest.rawVideo;
  const sourceSeconds = await duration(source);

  // ── 1. Where does each scene really start? ──────────────────────────
  console.log('  reading markers…');
  const track = await readMarkerTrack(source);
  const colours = [...manifest.scenes.map((s) => s.marker), manifest.endMarker];
  const startFrames = findSceneStarts(track, colours);
  const startTimes = startFrames.map((f) => f / FPS);

  // ── 2. Drift: the number that made this whole design necessary ──────
  const wallSpan =
    (manifest.scenes[manifest.scenes.length - 1].wallEnd - manifest.scenes[0].wallStart) / 1000;
  const videoSpan = startTimes[startTimes.length - 1] - startTimes[0];
  const drift = videoSpan / wallSpan;

  // ── 3. Retime each segment to its narration ─────────────────────────
  const segments = manifest.scenes.map((scene, i) => {
    const sourceStart = startTimes[i];
    const sourceEnd = startTimes[i + 1];
    const sourceDuration = sourceEnd - sourceStart;
    const target = clips[scene.id].seconds + SCENE_TAIL_SECONDS;
    if (sourceDuration <= 0.1) {
      throw new Error(
        `Scene "${scene.id}" is ${sourceDuration.toFixed(3)}s in the file — unusable.`,
      );
    }
    return {
      id: scene.id,
      sourceStart,
      sourceEnd,
      sourceDuration,
      target,
      factor: target / sourceDuration,
    };
  });

  const bodySeconds = segments.reduce((a, s) => a + s.target, 0);

  console.log(
    `  drift ${drift.toFixed(4)}x (video ${videoSpan.toFixed(1)}s vs wall ${wallSpan.toFixed(1)}s)`,
  );
  for (const s of segments) {
    console.log(
      `  · ${s.id.padEnd(16)} src ${s.sourceDuration.toFixed(2)}s → ${s.target.toFixed(2)}s  (x${s.factor.toFixed(3)})`,
    );
  }

  // ── 4. The video filtergraph ────────────────────────────────────────
  // One split per segment, each trimmed, retimed and cropped, then
  // concatenated. Cropping here rather than at the end means the marker
  // strip is gone before anything is scaled or faded over it.
  const parts = [];
  parts.push(
    `[0:v]crop=${FRAME_WIDTH}:${FRAME_HEIGHT}:0:${MARKER_STRIP},fps=${FPS},format=yuv420p,setsar=1,` +
      `split=${segments.length}${segments.map((_, i) => `[src${i}]`).join('')}`,
  );
  for (const [i, s] of segments.entries()) {
    parts.push(
      `[src${i}]trim=start=${s.sourceStart.toFixed(4)}:end=${s.sourceEnd.toFixed(4)},` +
        `setpts=(PTS-STARTPTS)*${s.factor.toFixed(6)}[seg${i}]`,
    );
  }
  parts.push(
    `${segments.map((_, i) => `[seg${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[body]`,
  );

  parts.push(
    cardFilter({
      title: video.title,
      subtitle: video.subtitle,
      seconds: INTRO_SECONDS,
      label: 'intro',
    }),
  );
  parts.push(
    cardFilter({
      title: 'skydrop.online',
      subtitle: video.title,
      seconds: OUTRO_SECONDS,
      label: 'outro',
    }),
  );
  // A short fade on the body's own ends, so the cut from and to the
  // cards is not a hard frame change.
  parts.push(
    `[body]fade=t=in:st=0:d=0.4,fade=t=out:st=${(bodySeconds - 0.5).toFixed(3)}:d=0.5[bodyf]`,
  );
  parts.push('[intro][bodyf][outro]concat=n=3:v=1:a=0[vout]');

  // ── 5. Audio: each clip delayed to its own scene's start ────────────
  // Offsets are computed from the TARGET durations, which is exactly what
  // the picture was just retimed to — so the two cannot disagree.
  const audioInputs = [];
  const audioFilters = [];
  let cursor = INTRO_SECONDS;
  for (const [i, s] of segments.entries()) {
    audioInputs.push('-i', clips[s.id].file);
    const delayMs = Math.round(cursor * 1000);
    audioFilters.push(`[${i + 1}:a]aresample=48000,adelay=${delayMs}|${delayMs},apad[a${i}]`);
    cursor += s.target;
  }
  const totalSeconds = INTRO_SECONDS + bodySeconds + OUTRO_SECONDS;
  audioFilters.push(
    `${segments.map((_, i) => `[a${i}]`).join('')}amix=inputs=${segments.length}:normalize=0:dropout_transition=0,` +
      `atrim=0:${totalSeconds.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,` +
      `afade=t=in:st=0:d=0.4,afade=t=out:st=${(totalSeconds - 0.8).toFixed(3)}:d=0.7[aout]`,
  );

  const graphFile = path.join(work, 'filtergraph.txt');
  await fs.writeFile(graphFile, [...parts, ...audioFilters].join(';\n'));

  /*
    THE TITLE CARD STAYS ENGLISH, deliberately.

    `cardFilter` draws with DejaVu, which carries no Bengali and no
    Devanagari glyph — a translated title would render as a row of
    boxes, which is worse than an English one. It is also consistent
    with the whole design: the INTERFACE stays English in every
    language (see `long/TRANSLATING.md`), so a card naming the product
    and the video in English is the same decision, not an omission.
    Translating it needs a Noto Bengali / Devanagari face installed and
    picked per language, which is a change to make deliberately.
  */
  const outFile = path.join(OUT_DIR, `${slug}${lang.suffix}.mp4`);
  console.log('  rendering…');
  await ffmpeg(
    [
      '-i',
      source,
      ...audioInputs,
      '-filter_complex_script',
      graphFile,
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-movflags',
      '+faststart',
      '-shortest',
      outFile,
    ],
    'render',
  );

  // The timeline the verifier checks against. Scene starts are in FINAL
  // time — intro card included — which is what a frame grab needs.
  const timeline = {
    slug,
    outFile,
    drift,
    sourceSeconds,
    videoSpan,
    wallSpan,
    introSeconds: INTRO_SECONDS,
    outroSeconds: OUTRO_SECONDS,
    totalSeconds: await duration(outFile),
    scenes: (() => {
      let at = INTRO_SECONDS;
      return segments.map((s) => {
        const entry = {
          id: s.id,
          start: at,
          end: at + s.target,
          clipSeconds: clips[s.id].seconds,
          sourceStart: s.sourceStart,
          sourceDuration: s.sourceDuration,
          retimeFactor: s.factor,
        };
        at += s.target;
        return entry;
      });
    })(),
  };
  await fs.writeFile(path.join(work, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  return timeline;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const langArg = args.find((a) => a.startsWith('--lang='));
  const lang = assertReady(language(langArg?.slice('--lang='.length) ?? 'en'));
  const slug = args.find((a) => !a.startsWith('--'));
  if (slug === undefined) {
    throw new Error('usage: node scripts/tutorials/compose.mjs [--lang=bn] <slug>');
  }
  console.log(`Composing ${slug} — ${lang.label}`);
  const timeline = await compose(slug, { lang });
  console.log(`\n  ${timeline.outFile}  ${timeline.totalSeconds.toFixed(1)}s`);
}

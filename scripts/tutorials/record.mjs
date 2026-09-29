/**
 * Drive the real seller app and record it.
 *
 * Each narrated step runs inside a SCENE BLOCK that (a) stamps the
 * scene's own marker colour into the top-left corner and (b) is held
 * open for at least its narration clip plus a tail, so the picture never
 * moves on before the voice has finished the sentence about it.
 *
 * The marker is the whole sync story — see `lib/stage.mjs`. The wall
 * time each scene took is recorded in `scenes.json` as well, purely as
 * evidence: the composer compares it against the marker positions to
 * report the drift factor, which is the number that made this design
 * necessary in the first place.
 *
 *   node scripts/tutorials/record.mjs <slug>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { SCENE_TAIL_SECONDS, videoBySlug } from './narration.mjs';
import { FLOWS } from './flows.mjs';
import { loadClips } from './generate-voice.mjs';
import { makeStage, markerFor, MARKER_IDLE, stageInitScript } from './lib/stage.mjs';
import { armMockSpaces } from './lib/spaces-shim.mjs';
import { CANVAS_HEIGHT, FRAME_WIDTH, MARKER_STRIP, RAW_DIR, VERIFY_DIR } from './lib/paths.mjs';

const BASE_URL = process.env.SELLER_APP_URL ?? 'http://127.0.0.1:3003';
const SELLER = {
  email: process.env.DEMO_SELLER_EMAIL ?? 'demo@rangpursilk.test',
  password: process.env.DEMO_SELLER_PASSWORD ?? 'Skydrop-Demo-2026',
};

/**
 * Drive a flow and record it — or, with `{ check: true }`, drive it and
 * record NOTHING.
 *
 * CHECK MODE exists because the expensive half of a re-take is not the
 * recording, it is finding out that a selector moved. A flow is ordinary
 * Playwright, so it can be run on its own: no narration is loaded, no
 * video is written, and each scene is held for a fixed beat instead of
 * for its clip. What it proves is exactly what goes stale — that every
 * step still finds what it reaches for.
 *
 * It is also the only way to work on a flow whose narration does not
 * exist yet, which is how it came to be written: the voice budget ran
 * out mid-library and two finished flows had no way to be exercised.
 */
export async function record(slug, { check = false } = {}) {
  const video = videoBySlug(slug);
  const flow = FLOWS[slug];
  if (flow === undefined) throw new Error(`No flow for "${slug}" in flows.mjs`);

  // Fail before the browser opens rather than filming a still frame: a
  // step with no action would record perfectly and only be noticed by
  // watching the finished video.
  const missing = video.steps.filter((s) => typeof flow.steps[s.id] !== 'function');
  if (missing.length > 0) {
    throw new Error(`flows.mjs has no action for: ${missing.map((s) => s.id).join(', ')}`);
  }
  const stray = Object.keys(flow.steps).filter((id) => !video.steps.some((s) => s.id === id));
  if (stray.length > 0) {
    throw new Error(`flows.mjs has actions with no narration: ${stray.join(', ')}`);
  }

  // In check mode every scene gets the same short beat: the point is to
  // reach each step, not to time it.
  const CHECK_SECONDS = 0.4;
  const clips = check
    ? Object.fromEntries(video.steps.map((st) => [st.id, { seconds: CHECK_SECONDS }]))
    : await loadClips(slug);
  const outDir = path.join(RAW_DIR, slug);
  // Check mode must not TOUCH the raw directory. It writes no video, so
  // wiping it would throw away a recording the composer still needs —
  // running a check to see whether a flow still works would silently
  // destroy the take it was checking on behalf of.
  if (!check) {
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
  }
  await fs.mkdir(VERIFY_DIR, { recursive: true });

  const browser = await chromium.launch({
    args: [
      '--force-device-scale-factor=1',
      '--hide-scrollbars=false',
      '--disable-lcd-text',
      // A tutorial must not show a browser's own "restore session" or
      // translate chrome over the app.
      '--disable-features=Translate,AutofillServerCommunication',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: FRAME_WIDTH, height: CANVAS_HEIGHT },
    deviceScaleFactor: 1,
    // No video in check mode — writing and flushing a webm is most of
    // the wall clock, and none of it is being looked at.
    ...(check
      ? {}
      : { recordVideo: { dir: outDir, size: { width: FRAME_WIDTH, height: CANVAS_HEIGHT } } }),
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    locale: 'en-IN',
    timezoneId: 'Asia/Dhaka',
  });
  await context.addInitScript(stageInitScript(MARKER_STRIP));

  // Only the flow that uploads a file gets the `mock://` PUT shim, so
  // the other videos record against a stock `fetch`. See
  // `lib/spaces-shim.mjs` for why a JS override and not `page.route`.
  if (flow.needsSpacesShim === true) {
    await armMockSpaces(context, {
      onStored: (file) => console.log(`  · stored mock object ${file}`),
    });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const stage = makeStage(page);

  /** @type {{ id: string, index: number, marker: number[], wallStart: number, wallEnd: number }[]} */
  const scenes = [];
  const startedAt = Date.now();
  let failure = null;

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await stage.marker(MARKER_IDLE);
    await flow.prologue({ page, stage, baseUrl: BASE_URL, seller: SELLER });
    await stage.marker(MARKER_IDLE);
    await page.waitForTimeout(700);

    for (const [index, step] of video.steps.entries()) {
      const clip = clips[step.id];
      if (clip === undefined) throw new Error(`No audio clip for step "${step.id}"`);

      const colour = markerFor(index);
      await stage.marker(colour);
      const wallStart = Date.now();

      await flow.steps[step.id]({ page, stage, baseUrl: BASE_URL });

      // Hold the scene for the clip plus a tail. The clip is the floor,
      // never the ceiling — a long action simply makes a long scene.
      const needMs = (clip.seconds + SCENE_TAIL_SECONDS) * 1000;
      const spent = Date.now() - wallStart;
      if (spent < needMs) await page.waitForTimeout(needMs - spent);

      scenes.push({ id: step.id, index, marker: colour, wallStart, wallEnd: Date.now() });
      console.log(
        `  · ${step.id.padEnd(16)} clip ${clip.seconds.toFixed(2)}s  scene ${(
          (Date.now() - wallStart) /
          1000
        ).toFixed(2)}s`,
      );
    }

    // An explicit END marker: the last real scene needs a boundary after
    // it, or the composer has nothing to measure its length against.
    await stage.marker(markerFor(video.steps.length));
    await stage.clearHalo();
    await page.waitForTimeout(check ? 200 : 1800);
  } catch (e) {
    failure = e;
    await page
      .screenshot({ path: path.join(VERIFY_DIR, `${slug}-failure.png`), fullPage: false })
      .catch(() => {});
    console.error(`\nRecording failed during "${scenes.length}" completed scenes: ${e.message}`);
  }

  await context.close(); // flushes the video file
  await browser.close();

  if (check) {
    if (failure !== null) throw failure;
    return { slug, checked: true, scenes: scenes.map((sc) => sc.id) };
  }

  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.webm'));
  const rawVideo = files[0] === undefined ? null : path.join(outDir, files[0]);
  if (rawVideo === null && failure === null) throw new Error('Playwright wrote no video file');

  const manifest = {
    slug,
    title: video.title,
    subtitle: video.subtitle,
    rawVideo,
    wallSeconds: (Date.now() - startedAt) / 1000,
    tailSeconds: SCENE_TAIL_SECONDS,
    endMarker: markerFor(video.steps.length),
    idleMarker: MARKER_IDLE,
    scenes: scenes.map((s) => ({
      ...s,
      clipSeconds: clips[s.id].seconds,
      wallSeconds: (s.wallEnd - s.wallStart) / 1000,
    })),
  };
  await fs.writeFile(path.join(outDir, 'scenes.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  if (failure !== null) throw failure;
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const slug = args.find((a) => !a.startsWith('--'));
  if (slug === undefined) {
    throw new Error('usage: node scripts/tutorials/record.mjs [--check] <slug>');
  }
  if (check) {
    console.log(`Checking the ${slug} flow against ${BASE_URL} (no audio, no video)`);
    const result = await record(slug, { check: true });
    console.log(`\n  every step reached: ${result.scenes.join(', ')}`);
  } else {
    console.log(`Recording ${slug} against ${BASE_URL}`);
    const manifest = await record(slug);
    console.log(`\n  raw video ${manifest.rawVideo}`);
    console.log(`  wall clock ${manifest.wallSeconds.toFixed(1)}s`);
  }
}

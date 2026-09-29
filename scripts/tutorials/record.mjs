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
import { videoBySlug } from './narration.mjs';
import { SCENE_TAIL_SECONDS } from './narration.mjs';
import { FLOWS } from './flows.mjs';
import { loadClips } from './generate-voice.mjs';
import { makeStage, markerFor, MARKER_IDLE, stageInitScript } from './lib/stage.mjs';
import { CANVAS_HEIGHT, FRAME_WIDTH, MARKER_STRIP, RAW_DIR, VERIFY_DIR } from './lib/paths.mjs';

const BASE_URL = process.env.SELLER_APP_URL ?? 'http://127.0.0.1:3003';
const SELLER = {
  email: process.env.DEMO_SELLER_EMAIL ?? 'demo@rangpursilk.test',
  password: process.env.DEMO_SELLER_PASSWORD ?? 'Skydrop-Demo-2026',
};

export async function record(slug) {
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

  const clips = await loadClips(slug);
  const outDir = path.join(RAW_DIR, slug);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
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
    recordVideo: { dir: outDir, size: { width: FRAME_WIDTH, height: CANVAS_HEIGHT } },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    locale: 'en-IN',
    timezoneId: 'Asia/Dhaka',
  });
  await context.addInitScript(stageInitScript(MARKER_STRIP));

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
    await page.waitForTimeout(1800);
  } catch (e) {
    failure = e;
    await page
      .screenshot({ path: path.join(VERIFY_DIR, `${slug}-failure.png`), fullPage: false })
      .catch(() => {});
    console.error(`\nRecording failed during "${scenes.length}" completed scenes: ${e.message}`);
  }

  await context.close(); // flushes the video file
  await browser.close();

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
  const slug = process.argv[2];
  if (slug === undefined) throw new Error('usage: node scripts/tutorials/record.mjs <slug>');
  console.log(`Recording ${slug} against ${BASE_URL}`);
  const manifest = await record(slug);
  console.log(`\n  raw video ${manifest.rawVideo}`);
  console.log(`  wall clock ${manifest.wallSeconds.toFixed(1)}s`);
}

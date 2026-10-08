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
import { resolveStack } from './lib/stacks.mjs';

/**
 * Which app a flow drives, and who it signs in as.
 *
 * A flow says `app: 'admin'` and gets apps/admin on :3002 and the
 * tutorial OPS staff user; say nothing and it gets apps/seller on :3003
 * and the demo seller, which every video before section H does. One
 * table rather than a second recorder, for the same reason `peek.mjs`
 * took a flag: the two consoles are the same shape by construction
 * (FE-5), and the only things that differ are the port and the
 * credentials.
 *
 * `tutorial-ops@skydrop.local` is created by `seed-demo-data.mjs` as a
 * SUPER_ADMIN — it exists because goods receipts are received by ops
 * rather than by the seller — so the admin videos need no new account.
 */
/**
 * THE PORTS COME FROM THE STACK (`lib/stacks.mjs`), not from a literal.
 *
 * Two agents film at once against two whole stacks, and the camera
 * pointing at the other agent's console is the one failure here that
 * would not look like a failure: the app answers, the sign-in works, and
 * the take is a perfectly good video of somebody else's demo world —
 * found only by watching it. The credentials are stack-INDEPENDENT (both
 * stacks seed the same demo seller and the same ops staff), so those
 * keep their env overrides.
 */
const STACK = resolveStack();

const APPS = {
  seller: {
    baseUrl: process.env.SELLER_APP_URL ?? STACK.seller.url,
    identity: {
      email: process.env.DEMO_SELLER_EMAIL ?? 'demo@rangpursilk.test',
      password: process.env.DEMO_SELLER_PASSWORD ?? 'Skydrop-Demo-2026',
    },
  },
  admin: {
    baseUrl: process.env.ADMIN_APP_URL ?? STACK.admin.url,
    identity: {
      email: process.env.TUTORIAL_OPS_EMAIL ?? 'tutorial-ops@skydrop.local',
      password: process.env.TUTORIAL_OPS_PASSWORD ?? 'Tutorial-Ops-2026',
    },
  },
  /**
   * The reseller portal — section R.
   *
   * A DIFFERENT PERSON, not a different view. This identity is Anjali
   * Deshpande, the owner of Pune Silk Studio — the store section G
   * already films the seller dealing WITH. Hers is the one seeded store
   * whose invitation is accepted, so it is the only one that can sign
   * in; Kolkata Silk Room is seeded with an invitation nobody takes up,
   * which is deliberate (G1 films it being sent).
   *
   * She cannot see what the stock costs, how
   * much of it there really is, the share held back from the catalogue,
   * or that any other store exists. Filming section R as the seller
   * would have produced videos that quietly show a shopkeeper figures
   * they are never shown, which is the one thing the reseller boundary
   * exists to prevent.
   */
  reseller: {
    baseUrl: process.env.RESELLER_APP_URL ?? STACK.reseller.url,
    identity: {
      email: process.env.DEMO_STORE_EMAIL ?? 'anjali@punesilkstudio.test',
      password: process.env.DEMO_STORE_PASSWORD ?? 'Store-Demo-2026',
    },
  },
  /**
   * The associate portal (ASSOC-1) — a THIRD person again, not a third
   * view.
   *
   * This is somebody who sells FOR Pune Silk Studio: the same `store`
   * identity the reseller app uses, signed in as a person whose role is
   * `associate`, so `order_scope` is OWN and the app shows only what
   * they sold. Filming it as Anjali would show a store owner's screens
   * and prove nothing — the whole point of this app is what it does NOT
   * show, and an owner sees all of it.
   *
   * `landing` is here because this app has no `/dashboard`: its root
   * redirects to `/orders` on purpose (there is no figure an associate
   * may see that would belong on a dashboard — every one is the store's
   * cost or the store's earnings). A sign-in helper that waits for
   * `/dashboard` therefore times out here, which is a thirty-second
   * failure with no error worth reading, so the wait is per app.
   */
  associate: {
    baseUrl: process.env.ASSOCIATE_APP_URL ?? STACK.associate.url,
    landing: /\/orders/,
    identity: {
      email: process.env.DEMO_ASSOCIATE_EMAIL ?? 'ravi@punesilkstudio.test',
      password: process.env.DEMO_ASSOCIATE_PASSWORD ?? 'Assoc-Demo-2026',
    },
  },
};

/** Where a signed-in session lands, per app. */
export const DEFAULT_LANDING = /\/dashboard/;

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
  // Named rather than defaulted, so a typo in a flow's `app` is a
  // thrown error and not a video quietly filmed against the wrong
  // console.
  const app = APPS[FLOWS[slug]?.app ?? 'seller'];
  if (app === undefined) {
    throw new Error(`Flow "${slug}" names an app that does not exist: ${FLOWS[slug].app}`);
  }
  const BASE_URL = app.baseUrl;
  const SELLER = app.identity;
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

  // CHECK MODE PROVES EVERY STEP WAS REACHED. It does not prove the
  // frame showed what the narration says about it — a step that finds
  // its target and dwells on a broken image, an empty list or a stale
  // panel passes exactly as loudly as one that works. `TUT_CHECK_SHOTS=1`
  // writes the end of every scene out, which is the cheapest way to look
  // before spending a credit. Off by default: the shots cost wall clock
  // and most check runs are about a moved selector.
  const shotDir = path.join(VERIFY_DIR, `${slug}-check`);
  const wantShots = check && process.env.TUT_CHECK_SHOTS === '1';
  if (wantShots) {
    await fs.rm(shotDir, { recursive: true, force: true });
    await fs.mkdir(shotDir, { recursive: true });
  }

  /** @type {{ id: string, index: number, marker: number[], wallStart: number, wallEnd: number }[]} */
  const scenes = [];
  const startedAt = Date.now();
  let failure = null;

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await stage.marker(MARKER_IDLE);
    /*
      ONE CONTEXT OBJECT, shared by the prologue and every step.

      They used to be two separate literals, so a prologue could not
      hand anything forward — and L2 needs to: a cycle count is recorded
      per (variant, bin, batch) and those ids are minted per box, so the
      flow reads them from the seed's fixture ONCE at sign-in rather
      than in each of the three steps that type them. Anything a step
      assigns is visible to the steps after it, which is the same shape
      the prologue already had with `page` and `stage`.
    */
    // `landing` travels in the context because WHERE a signed-in
    // session lands is a property of the APP, and the app table above
    // is the one place that knows it. A prologue that hard-codes
    // `/dashboard` works for three apps and times out for thirty
    // seconds on the associate portal, which has none (ASSOC-1) — and
    // a timeout there reads as a broken login rather than a wrong wait.
    const ctx = {
      page,
      stage,
      baseUrl: BASE_URL,
      seller: SELLER,
      landing: app.landing ?? DEFAULT_LANDING,
    };
    await flow.prologue(ctx);
    await stage.marker(MARKER_IDLE);
    await page.waitForTimeout(700);

    for (const [index, step] of video.steps.entries()) {
      const clip = clips[step.id];
      if (clip === undefined) throw new Error(`No audio clip for step "${step.id}"`);

      const colour = markerFor(index);
      await stage.marker(colour);
      const wallStart = Date.now();

      await flow.steps[step.id](ctx);

      // Hold the scene for the clip plus a tail. The clip is the floor,
      // never the ceiling — a long action simply makes a long scene.
      const needMs = (clip.seconds + SCENE_TAIL_SECONDS) * 1000;
      const spent = Date.now() - wallStart;
      if (spent < needMs) await page.waitForTimeout(needMs - spent);

      if (wantShots) {
        await page
          .screenshot({
            path: path.join(shotDir, `${String(index + 1).padStart(2, '0')}-${step.id}.png`),
          })
          .catch(() => {});
      }

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
    if (wantShots) console.log(`  shots → ${shotDir}`);
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
  const where = (APPS[FLOWS[slug]?.app ?? 'seller'] ?? APPS.seller).baseUrl;
  if (check) {
    console.log(`Checking the ${slug} flow against ${where} (no audio, no video)`);
    const result = await record(slug, { check: true });
    console.log(`\n  every step reached: ${result.scenes.join(', ')}`);
  } else {
    console.log(`Recording ${slug} against ${where}`);
    const manifest = await record(slug);
    console.log(`\n  raw video ${manifest.rawVideo}`);
    console.log(`  wall clock ${manifest.wallSeconds.toFixed(1)}s`);
  }
}

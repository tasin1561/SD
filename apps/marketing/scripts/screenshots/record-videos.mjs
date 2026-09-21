// Records one short webm per micro pattern from a running preview server:
// idle → busy → success, then the same by KEYBOARD only. 2D only — the 3D
// hero is never recorded under swiftshader. Usage (the render script
// starts/stops the server): node scripts/screenshots/record-videos.mjs <port> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [port, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

/** Per pattern: what to do with the pointer, then what to do by keyboard. */
const SCRIPTS = {
  'parachute-progress': {
    pointer: async (p, s) => {
      await s.locator('.mi-para__btn').first().click();
      await p.waitForTimeout(3200);
    },
    keys: async (p, s) => {
      await s.locator('.mi-para__btn').first().focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(3200);
    },
  },
  'van-drive-off': {
    pointer: async (p, s) => {
      await s.locator('button[type=submit]').first().click();
      await p.waitForTimeout(2600);
    },
    keys: async (p, s) => {
      await s.getByText('reset').click();
      await s.locator('button[type=submit]').first().focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(2600);
    },
  },
  'paper-plane-send': {
    pointer: async (p, s) => {
      await s.locator('input').fill('you@store.com');
      await s.locator('button[type=submit]').click();
      await p.waitForTimeout(2200);
    },
    keys: async (p, s) => {
      await s.locator('input').focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1200);
    },
  },
  'glow-field': {
    pointer: async (p, s) => {
      await s.locator('input').click();
      await p.keyboard.type('38061110', { delay: 120 });
      await p.waitForTimeout(800);
    },
    keys: async (p, s) => {
      await s.locator('input').focus();
      await p.keyboard.press('Control+A');
      await p.keyboard.type('12345678', { delay: 100 });
      await p.waitForTimeout(600);
    },
  },
  'rolling-label-button': {
    pointer: async (p, s) => {
      await s.locator('button').first().click();
      await p.waitForTimeout(3000);
    },
    keys: async (p, s) => {
      await s.locator('button').first().focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(3000);
    },
  },
  'label-into-parcel': {
    pointer: async (p, s) => {
      await s.locator('a').hover();
      await p.waitForTimeout(1200);
      await p.mouse.move(0, 0);
      await p.waitForTimeout(600);
    },
    keys: async (p, s) => {
      await s.locator('a').focus();
      await p.waitForTimeout(1200);
    },
  },
  'expanding-track-field': {
    pointer: async (p, s) => {
      await s.locator('.mi-etf__toggle').click();
      await p.keyboard.type('38061110487620', { delay: 60 });
      await p.waitForTimeout(600);
      await s.locator('.mi-etf__toggle').click();
      await p.waitForTimeout(600);
    },
    keys: async (p, s) => {
      await s.locator('.mi-etf__toggle').focus();
      await p.keyboard.press('Enter');
      await p.keyboard.type('3806', { delay: 80 });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(600);
    },
  },
  'liquid-bead': {
    pointer: async (p, s) => {
      for (const i of [1, 3, 5, 2]) {
        await s.locator('.mi-bead--pill [role=tab]').nth(i).click();
        await p.waitForTimeout(500);
      }
      for (const i of [1, 3, 0]) {
        await s.locator('.mi-bead--icon [role=tab]').nth(i).click();
        await p.waitForTimeout(500);
      }
    },
    keys: async (p, s) => {
      await s.locator('.mi-bead--pill [role=tab][aria-selected=true]').focus();
      for (let k = 0; k < 3; k++) {
        await p.keyboard.press('ArrowRight');
        await p.waitForTimeout(450);
      }
    },
  },
  'contact-fan': {
    pointer: async (p, s) => {
      await s.locator('.mi-fan__toggle').click();
      await p.waitForTimeout(900);
      await s.getByRole('button', { name: /Copy hotline/ }).click();
      await p.waitForTimeout(1800);
      await s.locator('.mi-fan__toggle').click();
      await p.waitForTimeout(800);
    },
    keys: async (p, s) => {
      await s.locator('.mi-fan__toggle').focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(700);
      await p.keyboard.press('Tab');
      await p.keyboard.press('Tab');
      await p.keyboard.press('Tab');
      await p.keyboard.press('Tab');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1600);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(600);
    },
  },
  'segmented-code': {
    pointer: async (p, s) => {
      await s.locator('input').first().click();
      await p.keyboard.type('560001', { delay: 160 });
      await p.waitForTimeout(2600);
    },
    keys: async (p, s) => {
      await s.locator('input').last().focus();
      for (let k = 0; k < 6; k++) await p.keyboard.press('Backspace');
      await s.locator('input').first().focus();
      await p.keyboard.type('900000', { delay: 140 });
      await p.waitForTimeout(1500);
    },
  },
  'scene-switcher': {
    pointer: async (p, s) => {
      for (const i of [1, 2, 3, 0]) {
        await s.locator('[role=tab]').nth(i).click();
        await p.waitForTimeout(900);
      }
    },
    keys: async (p, s) => {
      await s.locator('[role=tab]').nth(0).focus();
      await p.keyboard.press('Tab');
      await p.keyboard.press('Enter');
      await p.waitForTimeout(900);
    },
  },
  'feature-vignette': {
    pointer: async (p, s) => {
      await p.waitForTimeout(5800);
      await s.getByRole('button', { name: /Pause|Play/ }).click();
      await p.waitForTimeout(600);
    },
    keys: async (p, s) => {
      await s.getByRole('button', { name: /Pause|Play/ }).focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(2200);
    },
  },
  odometer: {
    pointer: async (p, s) => {
      await p.waitForTimeout(1400);
      await s.getByText('+1,137').click();
      await p.waitForTimeout(1400);
    },
    keys: async (p, s) => {
      await s.getByText('+1,137').focus();
      await p.keyboard.press('Enter');
      await p.waitForTimeout(1400);
    },
  },
  'reactive-mascot': {
    pointer: async (p, s) => {
      await s.locator('input').click();
      await p.keyboard.type('Rahim Uddin', { delay: 90 });
      await s.getByText('success').click();
      await p.waitForTimeout(1400);
    },
    keys: async (p, s) => {
      await s.locator('input').focus();
      await p.keyboard.type('Dhaka', { delay: 100 });
      await p.waitForTimeout(600);
    },
  },
  'door-hover': {
    pointer: async (p, s) => {
      await s.locator('a').first().hover();
      await p.waitForTimeout(1200);
      await p.mouse.move(0, 0);
      await p.waitForTimeout(600);
    },
    keys: async (p, s) => {
      await s.locator('a').first().focus();
      await p.waitForTimeout(1000);
      await p.keyboard.press('Tab');
      await p.waitForTimeout(1000);
    },
  },
  touches: {
    pointer: async (p, s) => {
      for (const b of [0, 1, 2]) {
        await s.locator('button').nth(b).click();
        await p.waitForTimeout(700);
      }
      await s.locator('#touch-email').fill('rahim@dhaka');
      await p.waitForTimeout(600);
      await s.locator('#touch-email').fill('rahim@dhaka.com');
      await p.waitForTimeout(700);
      await s.locator('.mi-check').click();
      await s.locator('.mi-toggle').click();
      await p.waitForTimeout(800);
    },
    keys: async (p, s) => {
      await s.locator('button').nth(0).focus();
      for (let k = 0; k < 3; k++) {
        await p.keyboard.press('Enter');
        await p.keyboard.press('Tab');
        await p.waitForTimeout(500);
      }
    },
  },
  'connector-draw': {
    pointer: async (p, s) => {
      await p.waitForTimeout(1800);
    },
    keys: async (p, s) => {
      await p.waitForTimeout(600);
    },
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const [id, script] of Object.entries(SCRIPTS)) {
    const ctx = await browser.newContext({
      viewport: { width: 900, height: 560 },
      recordVideo: { dir: outDir, size: { width: 900, height: 560 } },
    });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/dev/motion#${id}`, { waitUntil: 'networkidle' });
    const section = page.locator(`[data-pattern="${id}"]`);
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(
      (sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }),
      `[data-pattern="${id}"]`,
    );
    await page.waitForTimeout(700);
    try {
      await script.pointer(page, section);
      await page.waitForTimeout(500);
      await script.keys(page, section);
      await page.waitForTimeout(600);
    } catch (e) {
      console.log(`${id}: ${String(e.message).split('\n')[0]}`);
    }
    const video = page.video();
    await ctx.close();
    const path = await video.path();
    renameSync(path, join(outDir, `${id}.webm`));
    console.log(`recorded ${id}.webm`);
  }
  await browser.close();
  for (const f of readdirSync(outDir)) if (!/^[a-z-]+\.webm$/.test(f)) rmSync(join(outDir, f));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

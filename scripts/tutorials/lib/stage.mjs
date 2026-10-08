/**
 * The camera rig: page instrumentation plus the gestures a viewer needs
 * to see.
 *
 * Three things live here and nowhere else.
 *
 * 1. THE SYNC MARKER. Playwright's video clock drifts against wall time
 *    — the recording of a 12-second scene is not 12 seconds of video —
 *    so placing narration at the wall-clock offset we recorded at would
 *    desync progressively. Instead each scene stamps a 6x6 px square in
 *    the very top-left corner with a colour of its own, and the composer
 *    finds each scene's REAL start by reading those pixels back out of
 *    the finished file. The square sits inside an 8 px strip that the
 *    final render crops away, so the marker never reaches a viewer and
 *    nothing real is lost — the strip covers page rows that were being
 *    cropped anyway.
 *
 * 2. THE CLICK RIPPLE AND THE HIGHLIGHT. A screen recording with no
 *    cursor feedback looks like the page is operating itself. The
 *    highlight goes on BEFORE the click, because the question a viewer
 *    has is "which control is about to be used", and an outline that
 *    appears at the moment of the click answers it too late.
 *
 * 3. TYPING. Characters go in at ~55 ms, which is about the speed of
 *    someone typing carefully. Instant fills read as a form being
 *    submitted by a machine.
 */

/** Distinct enough to survive H.264 and 4:2:0 chroma subsampling. */
export const MARKER_COLOURS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [255, 0, 255],
  [0, 255, 255],
  [255, 128, 0],
  [128, 0, 255],
  [0, 255, 128],
  [255, 0, 128],
  [128, 255, 0],
  [0, 128, 255],
  [255, 255, 255],
  [128, 128, 128],
  [160, 80, 0],
  [0, 160, 80],
];

/** What the corner shows before the first scene, so scene 1 is a change. */
export const MARKER_IDLE = [0, 0, 0];

export function markerFor(index) {
  const colour = MARKER_COLOURS[index % MARKER_COLOURS.length];
  if (colour === undefined) throw new Error(`no marker colour for scene ${index}`);
  return colour;
}

/**
 * Injected before any page script runs, so it survives navigation. Kept
 * as a string rather than a function reference because it is evaluated
 * in the browser and must not close over anything from Node.
 */
export function stageInitScript(markerStrip) {
  return `
(() => {
  const STRIP = ${markerStrip};
  function mount() {
    if (document.getElementById('tut-strip') !== null) return;
    const style = document.createElement('style');
    style.id = 'tut-style';
    style.textContent = \`
      #tut-strip {
        position: fixed; top: 0; left: 0; width: 100vw; height: \${STRIP}px;
        background: #000; z-index: 2147483646; pointer-events: none;
      }
      #tut-marker {
        position: fixed; top: 0; left: 0; width: 6px; height: 6px;
        background: rgb(0,0,0); z-index: 2147483647; pointer-events: none;
      }
      .tut-halo {
        position: fixed; z-index: 2147483640; pointer-events: none;
        border: 2px solid #38bdf8; border-radius: 10px;
        box-shadow: 0 0 0 4px rgba(56,189,248,0.22), 0 0 22px rgba(56,189,248,0.45);
        transition: opacity 140ms ease;
      }
      .tut-ripple {
        position: fixed; z-index: 2147483641; pointer-events: none;
        width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        background: rgba(56,189,248,0.55);
        animation: tut-ripple-out 620ms ease-out forwards;
      }
      @keyframes tut-ripple-out {
        from { transform: scale(0.4); opacity: 0.9; }
        to   { transform: scale(5.5); opacity: 0; }
      }
      /* The recording must never catch a caret mid-blink on a still frame. */
      * { caret-color: transparent !important; }
    \`;
    document.head.appendChild(style);

    const strip = document.createElement('div');
    strip.id = 'tut-strip';
    document.body.appendChild(strip);

    const marker = document.createElement('div');
    marker.id = 'tut-marker';
    /*
      THE COLOUR SURVIVES A NAVIGATION, and that is not a nicety.

      This script is an init script, so it RE-RUNS on every full page
      load. The colour used to live only in the element's inline style,
      so a step that navigated came back with a BLACK marker and the
      scene's own colour was never painted again — the composer then
      never saw it.

      That is not a lost frame, it is a lost SCENE, and the damage
      compounds: the reader scans forward for the next match, the
      palette repeats every 16 scenes, so a missed marker is silently
      matched against the SAME colour sixteen scenes later and every
      scene after it is placed against the wrong picture. On a 43-scene
      video it consumed the whole recording and failed on the last
      colour it could not find — twice, identically, which is what
      proved it was the rig and not a capture wobble.

      sessionStorage is per tab and per origin and survives a
      navigation, which is exactly the lifetime of one take.
    */
    const saved = (() => {
      try {
        return sessionStorage.getItem('tut-marker');
      } catch {
        return null;
      }
    })();
    if (saved !== null) marker.style.background = saved;
    document.body.appendChild(marker);
  }

  const api = {
    marker(r, g, b) {
      mount();
      const css = 'rgb(' + r + ',' + g + ',' + b + ')';
      const el = document.getElementById('tut-marker');
      if (el !== null) el.style.background = css;
      // Remembered so a navigation inside this scene repaints it rather
      // than coming back black. See the note in mount() above.
      try {
        sessionStorage.setItem('tut-marker', css);
      } catch {
        /* A page that refuses storage still records; it just cannot
           survive a navigation, which is where this started. */
      }
    },
    halo(box) {
      mount();
      api.clearHalo();
      if (box === null) return;
      const el = document.createElement('div');
      el.className = 'tut-halo';
      el.dataset.tutHalo = '1';
      el.style.left = (box.x - 6) + 'px';
      el.style.top = (box.y - 6) + 'px';
      el.style.width = (box.width + 12) + 'px';
      el.style.height = (box.height + 12) + 'px';
      document.body.appendChild(el);
    },
    clearHalo() {
      for (const el of document.querySelectorAll('[data-tut-halo]')) el.remove();
    },
    ripple(x, y) {
      mount();
      const el = document.createElement('div');
      el.className = 'tut-ripple';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 700);
    },
  };

  window.__tut = api;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`;
}

/** Everything the flows use to touch the page. */
export function makeStage(page) {
  async function marker(rgb) {
    await page.evaluate(
      ([r, g, b]) => window.__tut.marker(r, g, b),
      /** @type {[number, number, number]} */ (rgb),
    );
  }

  async function halo(locator) {
    const box = await locator.boundingBox();
    if (box === null) return null;
    await page.evaluate((b) => window.__tut.halo(b), box);
    return box;
  }

  async function clearHalo() {
    await page.evaluate(() => window.__tut?.clearHalo());
  }

  /** Bring a control into view, outline it, then leave it outlined. */
  async function point(locator, { settle = 500 } = {}) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const box = await halo(locator);
    if (box !== null) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(settle);
    return box;
  }

  /** Outline → ripple → click. The order is the point; see the header. */
  async function clickIt(locator, { settle = 500, after = 500 } = {}) {
    const box = await point(locator, { settle });
    if (box !== null) {
      await page.evaluate(
        ([x, y]) => window.__tut.ripple(x, y),
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      await page.waitForTimeout(160);
    }
    await locator.click();
    await page.waitForTimeout(after);
    await clearHalo();
  }

  /** Type at a human rate, with the field outlined while it fills. */
  async function typeIn(locator, text, { delay = 55, after = 350, clear = false } = {}) {
    await point(locator, { settle: 260 });
    await locator.click();
    if (clear) await locator.fill('');
    await locator.pressSequentially(text, { delay });
    await page.waitForTimeout(after);
    await clearHalo();
  }

  /** Read without touching: outline something and hold. */
  async function dwellOn(locator, ms) {
    await point(locator, { settle: 200 });
    await page.waitForTimeout(ms);
    await clearHalo();
  }

  /** A slow, readable scroll rather than a jump. */
  async function glide(deltaY, steps = 26) {
    const per = deltaY / steps;
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, per);
      await page.waitForTimeout(26);
    }
    await page.waitForTimeout(220);
  }

  return { marker, halo, clearHalo, point, clickIt, typeIn, dwellOn, glide };
}

/**
 * Walk EVERY page of one app at several widths and report what breaks.
 *
 *   node scripts/ui-audit/audit.mjs associate
 *   node scripts/ui-audit/audit.mjs seller --widths=360
 *   node scripts/ui-audit/audit.mjs admin --shots      # also save PNGs
 *
 * ── WHY THIS EXISTS BESIDE `e2e-shared/responsive.spec.ts` ──────────
 * That spec is the GATE and must stay fast, so it sweeps one page per
 * layout shape — 16 authed routes out of 195. This sweeps all of them.
 * It is a FINDER, run by hand; the gate stays the gate.
 *
 * The probe below is lifted from that spec deliberately, rule for rule.
 * A second definition of "too small to tap" would mean this tool and CI
 * disagreeing about whether a page is fixed, and the one that blocks a
 * merge is the one that counts.
 *
 * ── LOAD ────────────────────────────────────────────────────────────
 * ONE browser, ONE page, routes in series. A sweep of ninety pages at
 * six widths is 540 navigations; doing them in parallel is how a laptop
 * starts swapping and every measurement becomes a lie about layout
 * while actually measuring contention. Slow and honest.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * The apps, their origin on filming stack A, and how to get inside.
 *
 * `landing` is per app because the associate portal has no dashboard —
 * every figure one would carry there is the store's cost or the store's
 * earnings (ASSOC-1), so it lands on `/orders`. A sign-in that waits
 * for `/dashboard` there hangs for thirty seconds and then reports a
 * failed login, which is why the CI spec skips that app's authed pages
 * entirely. This is the one more change that needed.
 */
const APPS = {
  admin: {
    baseUrl: 'http://127.0.0.1:3002',
    landing: /\/dashboard/,
    email: 'tutorial-ops@skydrop.local',
    password: 'Tutorial-Ops-2026',
  },
  seller: {
    baseUrl: 'http://127.0.0.1:3003',
    landing: /\/dashboard/,
    email: 'demo@rangpursilk.test',
    password: 'Skydrop-Demo-2026',
  },
  reseller: {
    baseUrl: 'http://127.0.0.1:3005',
    landing: /\/dashboard/,
    email: 'anjali@punesilkstudio.test',
    password: 'Store-Demo-2026',
  },
  associate: {
    baseUrl: 'http://127.0.0.1:3007',
    landing: /\/orders/,
    email: 'ravi@punesilkstudio.test',
    password: 'Assoc-Demo-2026',
  },
  track: { baseUrl: 'http://127.0.0.1:3004', landing: null, email: null, password: null },
};

/**
 * 360 is the one that matters — budget Androids in Bangladesh and India
 * are the real audience — but 320 is where a layout actually breaks and
 * 1280 is where a table stops being a stack and starts being a table.
 */
const WIDTHS = [320, 360, 414, 768, 1024, 1440];

/** Routes from the file system, because a hand-kept list goes stale. */
/**
 * Turn `/orders/[id]` into `/orders/<a real id>` by READING THE APP'S OWN
 * LIST PAGE, segment by segment. The parent of a dynamic segment is the
 * list that links to it, so `/orders` is visited and the first link one
 * level deeper gives the id; a nested param (`/products/[id]/variants/
 * [variantId]`) resolves left to right, each step visiting the concrete
 * parent the previous step produced.
 *
 * Read from the page rather than from the database on purpose: it needs
 * no credentials beyond the session the sweep already holds, it cannot
 * drift from the schema, and — the part that matters — it can only ever
 * pick a record this signed-in user is actually allowed to open, so a
 * resolved page is one a real person could reach.
 *
 * A STATIC SIBLING IS NOT AN ID. `/orders/new` and `/orders/import` are
 * real routes, and a list page links to them, so they are excluded by
 * name from the app's own route table. An unresolved route is REPORTED,
 * never silently dropped — a sweep that quietly skipped a page must not
 * read as a sweep that passed it.
 */
function templateOf(concrete, route) {
  const want = route.split('/');
  const got = concrete.split('/');
  return got.map((seg, i) => (want[i]?.startsWith('[') === true ? want[i] : seg)).join('/');
}

async function resolveDynamic(page, baseUrl, route, staticRoutes, allRoutes) {
  const segments = route.split('/').filter((x) => x !== '');
  let prefix = '';
  for (const seg of segments) {
    if (!seg.startsWith('[')) {
      prefix = `${prefix}/${seg}`;
      continue;
    }
    // `[...slug]` can be any depth and is not worth guessing at.
    if (seg.startsWith('[...')) return null;
    // THE NEAREST ANCESTOR THAT IS A PAGE, not blindly the parent path.
    // `/products/[id]/variants/[variantId]` would otherwise visit
    // `/products/<id>/variants`, which is no route at all — the variant
    // links live on the product page one level up. Walk up until a page
    // is found; the href match below still uses the FULL prefix, so a
    // link from the wrong depth cannot be mistaken for the right one.
    let list = prefix === '' ? '/' : prefix;
    // `allRoutes`, not `staticRoutes`: `/products/[id]` is where the
    // variant links live and it IS a page — just a dynamic one. Testing
    // against the static list alone walked straight past it up to
    // `/products`, where no variant link exists, and the route came back
    // unresolvable with nothing to say why.
    while (list !== '/' && !allRoutes.includes(templateOf(list, route))) {
      const up = list.slice(0, list.lastIndexOf('/'));
      list = up === '' ? '/' : up;
    }
    try {
      await page.goto(`${baseUrl}${list}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);
    } catch {
      return null;
    }
    const taken = new Set(
      staticRoutes
        .filter((r) => r.startsWith(`${prefix}/`))
        .map((r) => r.slice(prefix.length + 1).split('/')[0]),
    );
    const found = await page
      .evaluate(
        ({ pre: _pre, taken }) => {
          const pre = _pre;
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const href = a.getAttribute('href') ?? '';
            if (!href.startsWith(pre)) continue;
            const rest = href.slice(pre.length).split(/[?#]/)[0];
            if (rest === '' || rest.includes('/')) continue;
            if (taken.includes(rest)) continue;
            return rest;
          }
          return null;
        },
        { pre: prefix === '' ? '/' : `${prefix}/`, taken: [...taken] },
      )
      .catch(() => null);
    if (found === null) return null;
    prefix = `${prefix}/${found}`;
  }
  return prefix === '' ? '/' : prefix;
}

/**
 * Every page route of an app, and which of them sit inside the `(authed)`
 * route group. That second half decides whether a page is EXPECTED to
 * render the app shell: a sign-in screen, a password reset and the
 * impersonation handoff are all deliberately shell-less, and a guessed
 * prefix list would either excuse a real failure or flag a page that is
 * working perfectly. The route group is the app's own statement of which
 * is which, so it cannot drift from what the app actually does.
 */
async function routesFor(app) {
  const base = path.join(ROOT, 'apps', app, 'src', 'app');
  const out = [];
  const authed = new Set();
  async function walk(dir, url, inAuthed) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      // A route GROUP — `(authed)` — is a folder that is not a segment.
      if (name.startsWith('(') && name.endsWith(')')) {
        await walk(path.join(dir, name), url, inAuthed || name === '(authed)');
        continue;
      }
      // `@modal` parallel routes and `_components` are not pages.
      if (name.startsWith('@') || name.startsWith('_') || name === 'api') continue;
      await walk(path.join(dir, name), `${url}/${name}`, inAuthed);
    }
    const hasPage = entries.some((e) => e.isFile() && /^page\.(tsx|ts)$/.test(e.name));
    if (hasPage) {
      const route = url === '' ? '/' : url;
      out.push(route);
      if (inAuthed) authed.add(route);
    }
  }
  await walk(base, '', false);
  return { routes: out.sort(), authed };
}

/** The spec's probe, unchanged. See the note at the top of this file. */
export function probe() {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const overflowBy = doc.scrollWidth - vw;
  const findings = [];

  // Is anything between `el` and the root CLIPPING it on the x axis? A
  // clipped element cannot widen the document however far past the edge
  // its own box reaches, so blaming it for the scroll is a wrong
  // answer that sends somebody to edit the wrong file. The KPI card's
  // corner glow is the worked example: `position: absolute; right:
  // -30%` inside a card with `overflow: hidden` — deliberate, invisible
  // past the edge, and 26 of the sweep's findings.
  const clippedOnX = (el) => {
    for (
      let n = el.parentElement;
      n !== null && n !== document.documentElement;
      n = n.parentElement
    ) {
      const o = getComputedStyle(n);
      if (o.overflowX !== 'visible' || o.overflowY === 'clip') return true;
    }
    return false;
  };

  if (overflowBy > 0) {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.right <= vw + 2) continue;
      if (clippedOnX(el)) continue;
      // A FIXED ELEMENT SIZED BY ITS INSETS IS A CONSEQUENCE, NEVER THE
      // CAUSE. `.sk-toasts` is `position: fixed; left: 16px; right:
      // 16px`, so its width is whatever the layout viewport is — and in
      // mobile emulation the browser WIDENS that viewport to fit an
      // overflowing document. It therefore grew to `document width −
      // 32` on every page that overflowed for some other reason, and
      // reported itself as the widest offender. Measured across two
      // apps: toast width was always exactly `scrollWidth − 32`. A
      // fixed element with an explicit width can still overflow, so
      // only the inset-sized case is skipped.
      const fx = getComputedStyle(el);
      if (fx.position === 'fixed' && fx.left !== 'auto' && fx.right !== 'auto') continue;
      const parent = el.parentElement;
      if (parent && parent.getBoundingClientRect().right > vw + 2) continue;
      const cls = (el.className?.toString() ?? '').split(' ').slice(0, 4).join('.');
      findings.push({
        kind: 'overflow',
        detail: `<${el.tagName.toLowerCase()} class="${cls}"> is ${Math.round(rect.width)}px wide, ending ${Math.round(rect.right - vw)}px past the viewport`,
      });
      if (findings.length >= 4) break;
    }
  }

  // DID THE APP ACTUALLY RENDER? A clean result is the one to distrust:
  // a sweep that measured a sign-in screen, an error boundary or an empty
  // document reports exactly the same "no findings" as a sweep that
  // measured a perfect page. This is the positive half of the /login
  // guard — that one catches a bounce it can see in the URL, this one
  // catches every other way a page can fail to be the app.
  // EITHER author-placed frame counts. `.sk-shell` is the signed-in app;
  // `.sk-signin` is the shared signed-out frame every login, password
  // reset, invitation and impersonation handoff renders through. Asking
  // for the frame the page actually drew beats a list of paths somebody
  // has to remember to extend — which is how `/password-reset` and
  // `/impersonation/handoff` slipped past a list that already had the
  // right idea in it. A future signed-out page inherits this for free.
  const shell = document.querySelector('.sk-shell, [data-slot="nav-drawer"], .sk-signin') !== null;

  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch) {
    const controls = document.querySelectorAll(
      'button, select, textarea, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio])',
    );
    for (const el of Array.from(controls)) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 3 || rect.height < 3) continue;
      if (el.classList.contains('skydrop-hit')) continue;
      const style = getComputedStyle(el);
      if (el.tagName === 'A' && style.display === 'inline') continue;
      const label = (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 24);
      if (rect.height < 30 || rect.width < 20) {
        findings.push({
          kind: 'target',
          detail: `<${el.tagName.toLowerCase()}> "${label}" is ${Math.round(rect.width)}×${Math.round(rect.height)}px`,
        });
      }
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        const px = Number.parseFloat(style.fontSize);
        if (Number.isFinite(px) && px < 16) {
          findings.push({
            kind: 'ios-zoom',
            detail: `<${el.tagName.toLowerCase()}> "${label}" renders at ${px}px — under 16px, focusing it zooms mobile Safari`,
          });
        }
      }
    }
  }

  /*
    ── BEYOND THE DOCUMENT EDGE ────────────────────────────────────────
    Everything above asks whether the PAGE is too wide. These ask
    whether something inside it is broken while the page itself fits —
    text cut off inside a card, a child spilling past its parent, a
    column clipped vertically. A page can pass every rule above and
    still have a word sliced in half.

    Each rule excludes the DELIBERATE version of itself, because the
    repo uses all three on purpose:
      · `overflow-x: auto` on a wide table is the sanctioned pattern
        (CLAUDE.md FE-7), so a scrollable box is not a finding;
      · `text-overflow: ellipsis` is truncation somebody chose, and the
        tooltip or expand beside it is the rest of that decision;
      · absolute and fixed children are positioned out of flow on
        purpose — a dropdown is meant to leave its parent.
  */
  const textOf = (el) => (el.textContent ?? '').trim();
  const isOut = (st) => st.position === 'absolute' || st.position === 'fixed';
  /*
    A TEXT LEAF — an element whose children are all inline. The first
    version of the clipping rules asked any element with `overflow:
    hidden` whether its SUBTREE was wider than its box, and that is a
    different question: `.sk-signin` hides overflow to clip a
    decorative backdrop drawn deliberately larger than the viewport, so
    the rule reported the page's own headings as "cut off" when nothing
    about them was. Asking a leaf is asking about the text itself.
  */
  const isTextLeaf = (el) =>
    Array.from(el.children).every((c) => {
      const d = getComputedStyle(c).display;
      return d === 'inline' || d === 'contents' || d === 'none';
    });
  /*
    Deliberate overflow-hidden windows, excluded by name with the reason.
    `sk-async__window` is the ROLLING LABEL: an async button stacks
    "Place order / Placing… / Done / Not placed" and slides between
    them, so a box shorter than its contents is the mechanism, not a
    fault. A rule that cannot tell a slider from a clip will report
    every async button on every page forever, and a sweep that cries
    wolf on its own design system is one nobody reads twice.
  */
  const DELIBERATE_WINDOWS = ['sk-async__window', 'sk-roll', 'sk-marquee'];
  const isWindow = (el) => DELIBERATE_WINDOWS.some((c) => el.classList.contains(c));

  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (findings.length >= 12) break;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const label = textOf(el).slice(0, 40).replace(/\s+/g, ' ');
    const cls = (el.className?.toString() ?? '').split(' ').slice(0, 3).join('.');
    const tag = el.tagName.toLowerCase();

    // A. TEXT CLIPPED SIDEWAYS with nothing to say so.
    if (
      st.overflowX === 'hidden' &&
      st.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth > 0 &&
      label !== '' &&
      isTextLeaf(el) &&
      !isWindow(el)
    ) {
      findings.push({
        kind: 'clipped-x',
        detail: `<${tag} class="${cls}"> cuts ${el.scrollWidth - el.clientWidth}px of "${label}" off the right, with no ellipsis and nothing to scroll`,
      });
      continue;
    }

    // B. CLIPPED VERTICALLY — content simply invisible.
    //
    // A `line-clamp` is EXCLUDED, for the same reason `clipped-x`
    // excludes `text-overflow: ellipsis` one rule up: it is a DESIGNED
    // truncation that draws its own ellipsis, so the reader can see
    // there is more. The seller's notification list is the worked
    // example — two lines, an `aria-expanded` toggle, and the words
    // "Click to read it all" — and without this exclusion it was 53 of
    // the sweep's loudest findings, every one of them correct design.
    const clamp = st.webkitLineClamp ?? st.lineClamp ?? 'none';
    if (
      st.overflowY === 'hidden' &&
      (clamp === 'none' || clamp === '' || clamp === 'auto') &&
      el.scrollHeight > el.clientHeight + 2 &&
      el.clientHeight > 0 &&
      label !== '' &&
      isTextLeaf(el) &&
      !isWindow(el)
    ) {
      findings.push({
        kind: 'clipped-y',
        detail: `<${tag} class="${cls}"> hides ${el.scrollHeight - el.clientHeight}px below its box — "${label}" is cut off`,
      });
      continue;
    }

    // C. SPILLING PAST ITS PARENT while the parent is not scrollable,
    //    so the overlap is visible rather than reachable.
    //
    // A NEGATIVE MARGIN IS THE AUTHOR SAYING "extend past my box", so a
    // spill it fully explains is not a finding. The admin dashboard is
    // the worked example: the (i) beside a tip card carries
    // `margin: -14px -8px` on a coarse pointer — the standard way to
    // grow a 28px control to a 44px tap area WITHOUT moving the layout —
    // and therefore sticks exactly 8px out, 78 times in one sweep, every
    // one of them correct.
    //
    // It is the MARGIN and not the parent's appearance: a first attempt
    // skipped any parent that painted no border or background, which
    // would have silently thrown away the reseller finding this sweep
    // had already proved (a topic key 10px past `.sk-check`, whose CSS
    // is three lines and draws nothing). A spill LARGER than the margin
    // explains is still reported, so the exemption cannot cover for a
    // real one hiding behind it.
    const parent = el.parentElement;
    if (parent !== null && !isOut(st)) {
      const pst = getComputedStyle(parent);
      const prect = parent.getBoundingClientRect();
      const scrollable = /auto|scroll/.test(pst.overflowX) || /auto|scroll/.test(pst.overflowY);
      // The BUDGET is both negative inline margins, not just the right
      // one. A 44px tap box with `margin: -14px -8px` spills exactly 8px
      // out of an anchor that fits it — but when the anchor is itself
      // compressed (its own parent is tight) the same deliberate box
      // spills 9, 10, 11px, and measuring against the right margin alone
      // reported 18 of those on one screen. Measured on admin
      // `/settings`: button 44px fixed, anchor squeezed to 26px, nothing
      // visibly outside anything — the icon is 28px and centred. A real
      // break still shows, because a spill wider than the margins the
      // author wrote is not explained by them.
      const pull =
        -Math.min(0, Number.parseFloat(st.marginRight) || 0) -
        Math.min(0, Number.parseFloat(st.marginLeft) || 0);
      const spill = rect.right - prect.right;
      // TWO author signals together, and only together: a negative
      // inline margin ("my box extends past my parent") AND a parent
      // that paints no boundary ("there is no edge here to cross"). The
      // case is a fixed 44px tap box whose anchor is a transparent
      // positioning span the layout squeezed to 19px — so the spill is
      // unbounded by the margin, while the only thing a reader SEES is a
      // 28px icon centred inside it.
      //
      // Each signal alone was tried and was wrong. The margin alone
      // cannot cover an anchor compressed arbitrarily far. The parent's
      // appearance alone would have thrown away a finding this sweep had
      // already proved — a topic key 10px past `.sk-check`, whose CSS is
      // three lines and draws nothing — and that child has no negative
      // margin, which is exactly what tells the two apart.
      const parentPaintsEdge =
        pst.backgroundImage !== 'none' ||
        !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(pst.backgroundColor) ||
        Number.parseFloat(pst.borderTopWidth) > 0 ||
        Number.parseFloat(pst.borderRightWidth) > 0 ||
        Number.parseFloat(pst.borderBottomWidth) > 0 ||
        Number.parseFloat(pst.borderLeftWidth) > 0 ||
        pst.boxShadow !== 'none' ||
        pst.overflowX === 'hidden' ||
        pst.overflowX === 'clip';
      const deliberate = pull > 0 && !parentPaintsEdge;
      if (!scrollable && prect.width > 8 && spill > 2 && !deliberate && spill > pull + 1) {
        findings.push({
          kind: 'escapes-parent',
          detail: `<${tag} class="${cls}"> "${label}" ends ${Math.round(rect.right - prect.right)}px past its <${parent.tagName.toLowerCase()} class="${(parent.className?.toString() ?? '').split(' ').slice(0, 3).join('.')}">`,
        });
        continue;
      }
    }

    // D. TOO SMALL TO READ. 11px is below anything in the type scale.
    if (label !== '' && el.children.length === 0) {
      const px = Number.parseFloat(st.fontSize);
      // Under 10, not under 11: a count badge sits at 10px by design
      // across the estate, and a rule that fires on every notification
      // bell is noise rather than a finding. Below 10 nothing in the
      // type scale reaches, so it is a mistake rather than a choice.
      if (Number.isFinite(px) && px > 0 && px < 10 && !isOut(st)) {
        findings.push({
          kind: 'tiny-text',
          detail: `<${tag} class="${cls}"> "${label}" renders at ${px}px`,
        });
      }
    }
  }

  /*
    ── THE SECOND HALF: things that are broken while the box is fine ───
    Width rules catch a page that does not fit. These catch a page that
    fits and is still wrong — unreadable text, a control nobody can
    name, two buttons on top of each other, a picture that never loaded.
  */

  /*
    ── CONTRAST IS NOT MEASURED HERE, DELIBERATELY ─────────────────────
    Three versions of a contrast rule were written and all three were
    wrong, each more confidently than the last: the first picked one
    ancestor and called it "the background"; the second missed that a
    `::before` can BE the background (`sk-pg__page`, the active
    pagination button, read as white-on-white at 1.00:1 while being
    perfectly legible); the third composited the layer stack properly
    and still reported ordinary links at 1.45:1 where the real figure,
    worked by hand, is 7.47:1.

    The rule needs rendered pixels to be right — gradients, blend
    modes, backdrop filters and a theme that can change under it. A
    check that reports eighty-two failures on a sound page is worse
    than no check: it buries the real findings and teaches whoever runs
    it to skim past the output.

    It is also the least necessary rule here. FE-6 puts every colour in
    `@skydrop/ui` as a semantic token, and those ratios were COMPUTED
    rather than eyeballed when the palette was set — CLAUDE.md records
    the working (accent 5.2:1 as link text and as white-on-fill, every
    chip ≥4.5:1 on its own tint). Contrast is settled where the colours
    are defined, not per page.

    If it comes back, it should sample the rendered PIXELS behind the
    glyphs — screenshot the element's box, take the modal background
    colour — not reason about CSS.
  */

  // F. A CONTROL NOBODY CAN NAME — no text, no aria-label, no title.
  //    A screen reader announces "button", and so does a tooltip.
  for (const el of Array.from(document.querySelectorAll('button, a[href], input[type=submit]'))) {
    if (findings.length >= 16) break;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const name =
      (el.textContent ?? '').trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('value') ||
      (el.getAttribute('aria-labelledby') !== null ? 'by-id' : '') ||
      Array.from(el.querySelectorAll('[aria-label]'))
        .map((c) => c.getAttribute('aria-label'))
        .join(' ');
    if (name.trim() === '') {
      findings.push({
        kind: 'unlabelled',
        detail: `<${el.tagName.toLowerCase()}> at ${Math.round(rect.x)},${Math.round(rect.y)} has no accessible name — it announces as just "${el.tagName.toLowerCase()}"`,
      });
    }
  }

  // G. A PICTURE THAT NEVER ARRIVED. `naturalWidth === 0` after load is
  //    a broken src, not a slow one.
  for (const img of Array.from(document.images)) {
    if (findings.length >= 16) break;
    const src = img.getAttribute('src') ?? '';
    /*
      `mock://` is the FILMING STACK, not the product. `DEV_MOCK_SPACES`
      hands the page a scheme only the recorder's shim can serve, so a
      product picture never loads in a plain browser here while loading
      perfectly in production, where the same code presigns an https
      URL. Reporting it would be reporting the test rig.
    */
    if (src.startsWith('mock://')) continue;
    if (img.complete && img.naturalWidth === 0 && src !== '') {
      findings.push({
        kind: 'broken-image',
        detail: `<img src="${(img.getAttribute('src') ?? '').slice(0, 60)}"> did not load`,
      });
    }
  }

  // H. TWO CONTROLS ON TOP OF EACH OTHER. Capped at 60 elements —
  //    this is O(n²) and a settings page has hundreds of links.
  //
  // THREE KINDS OF OVERLAP ARE DESIGNED, and each one had to be told
  // apart from the bug or the rule reports nothing but noise:
  //
  //  · A control that PAINTS NOTHING cannot cover anything. The
  //    `.sk-choice__input` radio is `position: absolute; inset: 0;
  //    opacity: 0` over its own label — the standard way to keep a real
  //    input behind a styled card — and its box genuinely sits on top of
  //    whatever the card sits on top of.
  //  · A STICKY or FIXED element passes over content on purpose; that is
  //    the whole word. The order form's `.ord-bar` is the last thing in
  //    flow and sticks to the bottom, so a field under it mid-scroll
  //    scrolls clear a moment later.
  //  · An OVERLAY — a dropdown, popover, dialog, listbox — is meant to
  //    cover the page. The product picker is the worked example.
  //
  // What is left is the real failure: two controls that both paint, in
  // the same layer, sitting on each other — where a tap lands on the
  // wrong one and nobody can tell which.
  const paints = (el) =>
    el.checkVisibility === undefined
      ? true
      : el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  //  · An INERT control is not a control. The browser takes the whole
  //    subtree out of hit-testing and out of the a11y tree, so it cannot
  //    be tapped — and therefore cannot be tapped BY MISTAKE, which is
  //    the only thing this rule is about. `AccordionItem` is the pattern
  //    to copy: `inert={!open}` on the collapsed panel, whose links keep
  //    full-size rects stacked at the clip's origin and read as a pile
  //    of collisions with the trigger above them.
  //
  //    ADDITIONAL to `paints`, deliberately not a replacement. The two
  //    cover different ground and only overlap by luck: that panel is
  //    ALSO `opacity: 0`, so `paints` already skips it, but a region
  //    that is inert while fully opaque — a form disabled behind a
  //    confirmation step, a panel mid-fade — is invisible to every other
  //    test here and visible to this one. It is exact where the others
  //    infer: an attribute the author wrote, rather than a layer we
  //    deduced.
  const inert = (el) => el.closest('[inert]') !== null;
  // The nearest ancestor that LIFTS its subtree off the page, or null.
  // Compared by IDENTITY, not by kind: two controls inside the SAME
  // sticky header are siblings in one layer and a collision between
  // them is real — which is how the seller's notification bell was
  // caught sitting on top of the header's own search field. Only a pair
  // whose owners DIFFER has one floating over the other.
  const layerOwner = (el) => {
    for (let n = el; n !== null && n !== document.body; n = n.parentElement) {
      const st = getComputedStyle(n);
      if (st.position === 'fixed' || st.position === 'sticky') return n;
      if (
        n.matches(
          '[popover], dialog, [role=dialog], [role=listbox], [role=menu], [aria-modal=true]',
        )
      )
        return n;
      if (st.position !== 'static' && st.zIndex !== 'auto' && Number(st.zIndex) !== 0) return n;
    }
    return null;
  };
  // WHAT THE ELEMENT ACTUALLY SHOWS: its box intersected with the
  // visible box of every ancestor that clips. A row scrolled out of a
  // `max-height` list still HAS a rect, sitting wherever the unclipped
  // content would be — which on the order form is right on top of a
  // section two cards further down the page. Those two cannot collide:
  // one of them is not on screen. Comparing raw rects reported 21
  // collisions between a product row nobody can see and a field it is
  // nowhere near.
  const shownRect = (el) => {
    let r = el.getBoundingClientRect();
    for (
      let n = el.parentElement;
      n !== null && n !== document.documentElement;
      n = n.parentElement
    ) {
      const st = getComputedStyle(n);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const c = n.getBoundingClientRect();
      const left = Math.max(r.left, c.left);
      const top = Math.max(r.top, c.top);
      const right = Math.min(r.right, c.right);
      const bottom = Math.min(r.bottom, c.bottom);
      if (right <= left || bottom <= top) return null;
      r = { left, top, right, bottom, width: right - left, height: bottom - top };
    }
    return r;
  };
  const controls = [];
  const boxes = [];
  for (const el of Array.from(
    document.querySelectorAll('button, a[href], input:not([type=hidden]), select'),
  )) {
    if (controls.length >= 60) break;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || !paints(el) || inert(el)) continue;
    const r = shownRect(el);
    if (r === null || r.width <= 8 || r.height <= 8) continue;
    controls.push(el);
    boxes.push(r);
  }
  const layers = controls.map(layerOwner);
  for (let i = 0; i < controls.length && findings.length < 16; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      if (layers[i] !== layers[j]) continue;
      const a = boxes[i];
      const b = boxes[j];
      if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox <= 1 || oy <= 1) continue;
      const area = ox * oy;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && area / smaller > 0.3) {
        findings.push({
          kind: 'overlap',
          detail: `<${controls[i].tagName.toLowerCase()}> "${(controls[i].textContent ?? '').trim().slice(0, 18)}" and <${controls[j].tagName.toLowerCase()}> "${(controls[j].textContent ?? '').trim().slice(0, 18)}" cover each other by ${Math.round((area / smaller) * 100)}%`,
        });
        break;
      }
    }
  }

  // I. OFF THE LEFT EDGE. Nothing scrolls back to it.
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (findings.length >= 16) break;
    const st = getComputedStyle(el);
    if (st.position === 'fixed' || st.display === 'none' || st.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.left >= -2) continue;
    // DECORATION IS ALLOWED OFF-CANVAS. `sk-signin__glow` is a blur
    // placed deliberately beyond the edge; only content nobody can
    // reach is a finding, so the element has to carry text or be a
    // control before this counts.
    const carries =
      (el.textContent ?? '').trim() !== '' ||
      ['IMG', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'A'].includes(el.tagName);
    if (!carries) continue;
    const parent = el.parentElement;
    if (parent !== null && parent.getBoundingClientRect().left < -2) continue; // report the outermost
    findings.push({
      kind: 'offscreen-left',
      detail: `<${el.tagName.toLowerCase()} class="${(el.className?.toString() ?? '').split(' ').slice(0, 3).join('.')}"> starts ${Math.round(-rect.left)}px off the left edge, where nothing scrolls`,
    });
  }

  // J. DUPLICATE id — a `<label for>` then points at whichever came
  //    first, so tapping the second label focuses the wrong field.
  const ids = new Map();
  for (const el of Array.from(document.querySelectorAll('[id]'))) {
    const id = el.id;
    if (id === '') continue;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const [id, n] of ids) {
    if (findings.length >= 16) break;
    if (n > 1) {
      findings.push({
        kind: 'duplicate-id',
        detail: `id="${id}" appears ${n} times — a <label for> resolves to the first, so the other control cannot be reached by its label`,
      });
    }
  }

  return { overflowBy, shell, findings: findings.slice(0, 16) };
}

async function main() {
  const args = process.argv.slice(2);
  const app = args.find((a) => !a.startsWith('--'));
  if (app === undefined || APPS[app] === undefined) {
    throw new Error(`usage: node scripts/ui-audit/audit.mjs <${Object.keys(APPS).join('|')}>`);
  }
  const cfg = APPS[app];
  const shots = args.includes('--shots');
  const widthArg = args.find((a) => a.startsWith('--widths='));
  const widths =
    widthArg === undefined
      ? WIDTHS
      : widthArg
          .slice('--widths='.length)
          .split(',')
          .map((n) => Number.parseInt(n, 10));
  const only = args.find((a) => a.startsWith('--route='))?.slice('--route='.length);

  const { routes: all, authed } = await routesFor(app);
  const dynamic = all.filter((r) => r.includes('['));
  const staticRoutes = all.filter((r) => !r.includes('['));
  const routes = only !== undefined ? [only] : staticRoutes;

  const outDir = path.join(ROOT, 'scripts', 'ui-audit', 'out', app);
  await fs.mkdir(outDir, { recursive: true });

  console.log(
    `\n${app} — ${routes.length} static + ${only === undefined ? dynamic.length : 0} dynamic route(s) × ${widths.length} widths`,
  );

  const browser = await chromium.launch();
  const report = [];
  let checked = 0;
  let withFindings = 0;
  let unmeasured = 0;
  const unresolved = new Set();

  try {
    /*
      CLEAR THE LOGIN THROTTLE FIRST. Sign-in is 5 per 15 minutes per
      email+IP, and auditing four apps — each a sign-in, each re-run
      after every fix — exhausts that in an afternoon. A refused attempt
      also renews its own block, so retrying makes it worse. The sweep
      then fails at the login screen and reads as a broken app rather
      than as its own tenth visit.
    */
    if (cfg.email !== null) {
      await new Promise((resolve) => {
        const { spawn } = require('node:child_process');
        const c = spawn(
          'node',
          [path.join(ROOT, 'scripts/tutorials/lib/clear-login-throttle.mjs')],
          { stdio: 'ignore' },
        );
        c.on('close', () => resolve());
        c.on('error', () => resolve());
      });
    }

    /**
     * Sign in INSIDE the context that will use the session — never by
     * capturing a cookie jar and handing it to another context.
     *
     * ── WHY NOT HAND IT OVER ──────────────────────────────────────────
     * The client refreshes silently, which ROTATES the refresh cookie
     * (FE-4). A jar captured before that holds the SUPERSEDED token, so
     * a second context presents a cookie the first already spent, the
     * API reads it as replay and burns the whole family
     * (`security.refresh_replay_detected`) — and every page after it is
     * bounced to /login while the sweep happily reports no findings.
     *
     * It was six contexts and five handovers; then two contexts and one
     * handover with a settle before capture, which NARROWED the race and
     * did not close it — admin lost its session 25 routes into the
     * second context, 103 page-widths unmeasured. A fresh sign-in has no
     * handover to lose, and two logins per app is well inside the
     * throttle the capture was invented to avoid.
     */
    const signIn = async (page) => {
      if (cfg.email === null) return;
      // WARM THE ROUTE FIRST, untimed. A Next app that has just been
      // restarted compiles its first request, and on admin that took the
      // 30s sign-in wait with it — reported as a sign-in failure, which
      // reads as a broken app rather than as a cold start.
      await page.goto(`${cfg.baseUrl}/login`, { waitUntil: 'load', timeout: 90_000 });
      await page.goto(`${cfg.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel(/email/i).first().fill(cfg.email);
      await page
        .getByLabel(/password/i)
        .first()
        .fill(cfg.password);
      await page
        .getByRole('button', { name: /sign in|log in/i })
        .first()
        .click();
      await page.waitForURL(cfg.landing, { timeout: 60_000 });
    };

    // ONE CONTEXT PER POINTER KIND, resized between widths — not one per
    // width. `setViewportSize` changes the width without a new session,
    // and the pointer kind is the only thing that genuinely needs its own
    // context, because `hasTouch` and `isMobile` are context options
    // Playwright cannot change afterwards. Each one signs in for itself.
    const groups = [
      { touch: true, widths: widths.filter((w) => w <= 768) },
      { touch: false, widths: widths.filter((w) => w > 768) },
    ].filter((g) => g.widths.length > 0);

    for (const group of groups) {
      const ctx = await browser.newContext({
        baseURL: cfg.baseUrl,
        viewport: { width: group.widths[0], height: 780 },
        // Coarse pointer so the tap-target and iOS-zoom rules apply —
        // they are the half of this that only exists on a phone.
        hasTouch: group.touch,
        isMobile: group.touch,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      await signIn(page);
      if (cfg.email !== null) console.log(`  signed in (${group.touch ? 'touch' : 'pointer'})`);

      // Resolve the dynamic routes ONCE per context, then sweep them
      // beside the static ones. Once per context rather than once per
      // width because the ids do not change with the viewport, and each
      // resolution costs a list-page load.
      const resolved = new Map();
      if (only === undefined && dynamic.length > 0) {
        for (const d of dynamic) {
          const real = await resolveDynamic(page, cfg.baseUrl, d, staticRoutes, all);
          if (real === null) {
            unresolved.add(d);
          } else {
            resolved.set(real, d);
          }
        }
        const got = [...resolved.keys()];
        if (got.length > 0)
          console.log(`  resolved ${got.length}/${dynamic.length} dynamic route(s)`);
      }
      const sweep = [...routes, ...resolved.keys()];

      for (const width of group.widths) {
        await page.setViewportSize({ width, height: 780 });

        for (const route of sweep) {
          checked += 1;
          let result;
          try {
            await page.goto(`${cfg.baseUrl}${route}`, {
              waitUntil: 'domcontentloaded',
              timeout: 25_000,
            });
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(350);
            result = await page.evaluate(probe);
          } catch (e) {
            // A page that THREW is unmeasured too, and for a while this
            // recorded it and let the summary say "0 with findings" —
            // the exact shape the guards below exist to stop. One
            // transient `ERR_NETWORK_CHANGED` on associate `/tickets/new`
            // read as a clean run.
            const detail = String(e).split('\n')[0].slice(0, 160);
            unmeasured += 1;
            report.push({ route, width, error: detail });
            console.log(`  ${String(width).padStart(4)}px ${route}  NOT MEASURED — ${detail}`);
            continue;
          }
          // A bounce to /login means this page was never measured. Louder
          // than a finding, because it invalidates the result rather than
          // describing it — a sweep that did not run must never read as a
          // sweep that passed.
          if (cfg.email !== null && !route.startsWith('/login') && /\/login/.test(page.url())) {
            unmeasured += 1;
            report.push({ route, width, loggedOut: true });
            console.log(
              `  ${String(width).padStart(4)}px ${route}  NOT MEASURED — bounced to /login`,
            );
            continue;
          }
          // Signed in, not a login route, and yet no app shell: whatever
          // was measured, it was not the page. Counted with the bounces
          // rather than as a finding, because it invalidates the result.
          // Belt AND braces: the route group says this page should be the
          // signed-in app, and the page itself says it rendered neither
          // frame. Both have to agree before a result is thrown away.
          const template = resolved.get(route) ?? route;
          if (cfg.email !== null && authed.has(template) && result.shell !== true) {
            unmeasured += 1;
            report.push({ route, width, noShell: true });
            console.log(
              `  ${String(width).padStart(4)}px ${route}  NOT MEASURED — the app shell never rendered`,
            );
            continue;
          }
          if (result.findings.length > 0) {
            withFindings += 1;
            report.push({ route, width, ...result });
            const head = `  ${String(width).padStart(4)}px ${route}`;
            console.log(
              `${head}\n${result.findings.map((f) => `        ${f.kind}: ${f.detail}`).join('\n')}`,
            );
            if (shots) {
              const name = `${route.replace(/\//g, '_') || '_root'}@${width}.png`;
              await page
                .screenshot({ path: path.join(outDir, name), fullPage: true })
                .catch(() => {});
            }
          }
        }
        console.log(`  ${width}px done`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  await fs.writeFile(
    path.join(outDir, 'findings.json'),
    `${JSON.stringify({ app, widths, routes: routes.length, dynamic, report }, null, 2)}\n`,
  );

  const byKind = {};
  for (const r of report)
    for (const f of r.findings ?? []) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
  console.log(`\n${app}: ${checked} page-widths checked, ${withFindings} with findings`);
  for (const [k, n] of Object.entries(byKind)) console.log(`  ${k}: ${n}`);
  // A route whose id could not be read off a list page is NAMED. It is
  // not a finding and not a failure — most often the list is simply
  // empty in this seed — but a page nobody looked at must never be
  // invisible in the result.
  if (unresolved.size > 0) {
    console.log(
      `\n  ${unresolved.size} dynamic route(s) NOT SWEPT — no record to open:\n` +
        `     ${[...unresolved].join(', ')}`,
    );
  }
  if (unmeasured > 0) {
    console.log(
      `\n  !! ${unmeasured} page-width(s) NOT MEASURED — the page threw, was bounced\n` +
        `     to /login, or rendered neither the app shell nor the sign-in frame.\n` +
        `     Treat this run as INCOMPLETE, not as clean.`,
    );
  }
  console.log(`  report: scripts/ui-audit/out/${app}/findings.json`);
}

// Only sweep when this file IS the command. `probe` is imported by
// `_selftest.mjs`, and an import that launches a browser is a trap.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

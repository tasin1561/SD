/**
 * The long videos and the promos, registered into the shared tables.
 *
 * ── WHY THERE IS AN ADAPTER HERE ────────────────────────────────────
 * `flows.mjs` keys a flow's steps by id — `steps: { async intro(ctx) {} }`
 * — because `record.mjs` looks a step up by name (`flow.steps[s.id]`).
 * The modules in this directory declare them as an ARRAY of
 * `{ id, run }` instead, and that is kept rather than corrected:
 *
 *   · the array preserves ORDER, which is the one thing a reader of a
 *     twelve-minute script wants and an object does not promise;
 *   · it gives every step somewhere to carry its own docblock, which is
 *     where the reason for a shot belongs;
 *   · and the id appears once, so a step cannot be named one thing in
 *     the narration and another in the flow without the id-match check
 *     catching it.
 *
 * So the shape is converted once, here, instead of four authors writing
 * the shape the runner happens to want.
 *
 * ── WHY THE REGISTRATION IS A SPREAD AND NOT AN EDIT ────────────────
 * `narration.mjs` is 5,500 lines and `flows.mjs` is 16,600. Writing a
 * long video directly into them means every author editing the same two
 * files. Each video is its own module; these two tables are the only
 * shared lines, and adding the next one is one import and one entry.
 */

import * as seller from './seller.mjs';
import * as reseller from './reseller.mjs';
import * as associate from './associate.mjs';
import * as promoSeller from './promo-seller.mjs';
import * as promoReseller from './promo-reseller.mjs';
import * as promoAssociate from './promo-associate.mjs';

/** Every long-form module, in the order they are meant to be watched. */
const MODULES = [seller, reseller, associate, promoSeller, promoReseller, promoAssociate];

/**
 * `[{ id, run }]` → `{ id: run }`, refusing the mistakes that would
 * otherwise surface as a video rather than as an error.
 */
function stepsByIdFor(slug, steps) {
  if (!Array.isArray(steps)) {
    throw new Error(`${slug}: flow.steps must be an array of { id, run } — see long/README.md`);
  }
  const out = {};
  for (const step of steps) {
    if (typeof step?.id !== 'string' || step.id === '') {
      throw new Error(`${slug}: a flow step has no id`);
    }
    if (typeof step.run !== 'function') {
      throw new Error(`${slug}: flow step "${step.id}" has no run()`);
    }
    // A duplicate id would silently drop the earlier step's action and
    // film the later one twice — a defect only visible by watching.
    if (out[step.id] !== undefined) throw new Error(`${slug}: duplicate flow step "${step.id}"`);
    out[step.id] = step.run;
  }
  return out;
}

/** The narration entries, for `VIDEOS`. */
export const LONG_VIDEOS = MODULES.map((m) => m.narration);

/**
 * Sign in, and wait for wherever THIS app lands.
 *
 * `record.mjs` calls `flow.prologue(ctx)` before the first scene, and
 * every flow in `flows.mjs` answers it with the same two lines. None of
 * the six modules here declared one — the contract they were written
 * against named `steps` and said nothing about this — so rather than
 * six copies of a sign-in, it is supplied ONCE, here, beside the steps
 * adapter that exists for the same reason.
 *
 * `ctx.landing` rather than `/dashboard`: the associate portal has no
 * dashboard (ASSOC-1 — every figure that would belong on one is the
 * store's cost or the store's earnings), so a hard-coded wait there is
 * a thirty-second timeout reported as a failed login. The app table in
 * `record.mjs` is the one place that knows, and it passes the answer in.
 *
 * A module may still declare its own `prologue` and it wins — a video
 * that needs to arrive somewhere other than the landing page says so
 * for itself.
 */
function signInFor(slug) {
  return async function prologue({ page, seller, baseUrl, landing }) {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel(/email/i).first().fill(seller.email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(seller.password);
    await page
      .getByRole('button', { name: /sign in|log in/i })
      .first()
      .click();

    try {
      await page.waitForURL(landing, { timeout: 25_000 });
    } catch (e) {
      // The refusal is on the page and is the only useful thing to
      // report: a throttled login and a wrong password both present as
      // "the URL never changed", and the two need different remedies.
      const body =
        (await page
          .locator('body')
          .innerText()
          .catch(() => '')) ?? '';
      const line = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /\[[A-Z_]+\]|too many|invalid|incorrect/i.test(l));
      throw new Error(
        line === undefined
          ? `${slug}: sign-in never reached ${String(landing)} — ${e.message}`
          : `${slug}: sign-in refused: ${line}\n(login is throttled 5 per 15 minutes per email+IP)`,
      );
    }
  };
}

/** The flow entries, for `FLOWS`, keyed by slug. */
export const LONG_FLOWS = Object.fromEntries(
  MODULES.map((m) => {
    const slug = m.narration.slug;
    const { steps, ...rest } = m.flow;
    return [slug, { prologue: signInFor(slug), ...rest, steps: stepsByIdFor(slug, steps) }];
  }),
);

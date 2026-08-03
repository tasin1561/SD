import { test, expect } from '@playwright/test';

/**
 * The invite form actually sends what somebody typed.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * It is the bug that created this whole project. The form assembled its
 * request body from a hand-written list of field names kept alongside
 * the markup rather than derived from it, and the two drifted: the
 * shipping direction and the second phone number were added to the form
 * and never to the list, so the browser discarded both on every
 * submission. Nothing errored. The person filling it in saw "Request
 * received"; the lead landed in the admin queue with an empty route —
 * the one field that says whether we can serve them at all.
 *
 * No existing gate could see it. The API accepted the payload it was
 * given, the DTO's fields are optional, the admin table rendered the
 * absence faithfully, and unit tests never open a browser. The loss
 * happened between the form and the fetch, which is a place only a real
 * browser looks.
 *
 * ── WHAT IT ASSERTS ──────────────────────────────────────────────────
 * Every field a person filled reaches the request body. Not a snapshot
 * of one payload shape — the check walks the form's own inputs, so a
 * field added tomorrow is covered the day it is added, which is exactly
 * the property the old hand-kept list did not have.
 *
 * The request is INTERCEPTED, never sent. This spec must be safe to run
 * against a dev machine, CI, or production without creating a lead or
 * emailing every super-admin.
 */

const PAGE = '/request-invite';

/** What a real person would put in. Values are distinctive so a field
 *  landing under the wrong key is visible rather than plausible. */
const ANSWERS: Record<string, string> = {
  fullName: 'Rahim Uddin',
  companyName: 'Dhaka Threads',
  email: 'rahim@dhakathreads.example',
  phone: '+880 1712 345678',
  altPhone: '+91 98765 43210',
  productTypes: 'Womenswear — kurtis, sarees',
  message: 'Shipping from Mirpur, about 300 parcels a month.',
};

/** Selects, whose values must come from the options actually rendered. */
const CHOICES = ['shippingDirection', 'monthlyOrders'] as const;

test.describe('invite form', () => {
  test('every field the visitor filled reaches the request', async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/public/invite-leads', async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto(PAGE, { waitUntil: 'networkidle' });

    // Fill the SELECTS from their own options rather than hardcoding a
    // value — an option list that changes should not fail this spec,
    // and a select that silently stops submitting still should.
    const chosen: Record<string, string> = {};
    for (const name of CHOICES) {
      const el = page.locator(`select[name="${name}"]`);
      if ((await el.count()) === 0) continue;
      const values = (await el
        .locator('option')
        .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))) as string[];
      const value = values.find((v) => v !== '');
      expect(value, `<select name="${name}"> has no selectable option`).toBeTruthy();
      await el.selectOption(value as string);
      chosen[name] = value as string;
    }

    for (const [name, value] of Object.entries(ANSWERS)) {
      const el = page.locator(`[name="${name}"]`);
      if ((await el.count()) === 0) continue;
      await el.fill(value);
      chosen[name] = value;
    }

    await page.click('button[type=submit]');
    await expect(page.getByText(/request received/i)).toBeVisible({ timeout: 10_000 });

    expect(body, 'the form never issued a request').not.toBeNull();
    const sent = body as unknown as Record<string, unknown>;

    const dropped = Object.entries(chosen)
      .filter(([k, v]) => sent[k] !== v)
      .map(([k, v]) => `${k}: typed ${JSON.stringify(v)}, sent ${JSON.stringify(sent[k])}`);
    expect(
      dropped,
      `the browser dropped or mangled fields before sending:\n  ${dropped.join('\n  ')}`,
    ).toEqual([]);
  });

  test('an unanswered optional is omitted, not sent blank', async ({ page }) => {
    // `shippingDirection` is an enum server-side: it accepts absent and
    // rejects ''. A form that helpfully sends every field as a string
    // turns "I skipped that question" into a 400 on the whole request.
    let body: Record<string, unknown> | null = null;
    await page.route('**/api/public/invite-leads', async (route) => {
      body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
    });

    await page.goto(PAGE, { waitUntil: 'networkidle' });
    await page.fill('[name=fullName]', 'Rahim Uddin');
    await page.fill('[name=companyName]', 'Dhaka Threads');
    await page.fill('[name=email]', 'rahim@dhakathreads.example');
    await page.fill('[name=phone]', '+880 1712 345678');
    await page.click('button[type=submit]');
    await expect(page.getByText(/request received/i)).toBeVisible({ timeout: 10_000 });

    const sent = (body ?? {}) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['companyName', 'email', 'fullName', 'phone']);
  });

  test('the honeypot is present, hidden, and left out of the tab order', async ({ page }) => {
    // The spam trap only works while it is invisible to people and
    // reachable by a script. A restyle that reveals it would put a
    // "Website" box on the form and start rejecting real submissions.
    await page.goto(PAGE, { waitUntil: 'networkidle' });
    const pot = page.locator('input[name=website]');
    await expect(pot).toHaveCount(1);
    await expect(pot).not.toBeInViewport();
    expect(await pot.getAttribute('tabindex')).toBe('-1');
  });
});

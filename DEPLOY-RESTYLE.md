# Deploying the apps restyle — track → seller → reseller → admin

Branch `feat/apps-premium-restyle` (39 commits on `9fc408fa`, which is exactly
what production runs today — `~/app` HEAD and `.last-deployed-sha` both read
`9fc408fa`, checked 2026-09-24). Nothing here has been pushed or deployed.
Every command that pushes, deploys or touches the droplet is **the owner's to
run**; this file only says what to run.

---

## 0. Three facts that shape the plan

1. **There is no staging environment.** Caddy serves no `stg-*` host (the DNS
   records were deleted on 2026-08-07) and pm2 runs one copy of each app. The
   "staging" here is a **staged rollout to production**, one app per stage,
   each with a smoke check and a one-app rollback that takes under a minute.
   The full stack was rehearsed locally (builds, 37 Playwright tests, 88-page
   overflow sweep, reduced motion, focus, interaction latency — see
   `APPS-INVENTORY.md` §9). If a real staging host is wanted, it is a separate
   job (a second checkout, four more pm2 processes, DNS + Caddy) and is not
   described here.

2. **The pipeline deploys `main`, whole.** `Deploy` runs only after `CI`
   passes on a push to `main`; `scripts/deploy.sh` builds all four apps from
   one checkout, and because `packages/ui` changes at every stage it restarts
   **all six** pm2 processes each time (api, portal, admin, seller, track,
   reseller). So "deploy one app" means: move `main` to a commit where only
   that app has changed *visibly*. The apps not yet restyled are rebuilt and
   restarted too, but render exactly as before: Phase 1 only added hook
   class names (`sd-badge`, `sd-thead`, …) to the legacy components, and those
   names are styled only by `brand/app.css`, which an unmigrated app does not
   load. Each stage's smoke list therefore includes one look at the apps that
   should NOT have changed.

3. **Two of the branch's commit points are not deployable as they stand**, so
   a release branch reorders them (step 1). Nothing in the code changes.
   - At the end of the seller phase (`da6672b3`), the admin test
     `wallet-topup.test.ts` still pins the seller wallet's OLD tab code, which
     Phase 3 had replaced; it was only updated in `ad8f4e2e`. CI fails there,
     so Deploy would never run. Checked by reading both files at that commit.
   - The admin skin (`ad8f4e2e`) was committed in the middle of the reseller
     phase, so the end of the reseller phase would ship admin's new shell over
     its old pages.

---

## 1. Prepare `release/restyle` (once, locally)

Same final tree as the feature branch, commits reordered so each stage point
is a clean, testable snapshot. Tag each stage point.

```bash
git switch -c release/restyle 9fc408fa

# Stage 1 — Phase 0/1 (shared package, tests), Phase 2 (track).
# Also carries 4e9bbb5e: the admin pack/handover scan field regains focus
# after a refused scan is acknowledged (a behaviour fix, pinned by a spec).
git cherry-pick 55dd00b6^..f6d46e97
git tag restyle-stage-1

# Stage 2 — Phase 3 (seller), plus ONLY the wallet-topup test hunk from
# ad8f4e2e so CI passes at this point.
git cherry-pick bb0b8df2^..da6672b3
git checkout ad8f4e2e -- apps/admin/src/tests/wallet-topup.test.ts
git commit -m "test(admin): wallet-topup reads the seller wallet's Phase 3 tab form"
git tag restyle-stage-2

# Stage 3 — Phase 4 (reseller) WITHOUT the admin skin.
git cherry-pick 5f25c08d 8ce282f6 9a41d0b6 d976a9ed 326e8cc3
git tag restyle-stage-3

# Stage 4 — Phase 5 (admin), Phase 6, Phase 7.
git cherry-pick ad8f4e2e            # wallet-topup.test.ts is already applied:
                                    # if git stops, take the staged version and
                                    # `git cherry-pick --continue`
git cherry-pick db363661^..365daea8
git cherry-pick <this file's commit>
git tag restyle-stage-4

# MUST print nothing: the release branch ends byte-identical to the feature branch.
git diff release/restyle feat/apps-premium-restyle -- . ':!DEPLOY-RESTYLE.md'
```

**Prove each stage green before it goes near `main`.** CI runs on pull
requests to `main` (`ci.yml`: `pull_request: branches: [main]`), and Deploy
does not. Push each tag's commit to its own branch and open a PR (pushing a
non-main branch is the owner's call):

```bash
for n in 1 2 3 4; do git push origin restyle-stage-$n:refs/heads/release/restyle-stage-$n; done
# open one PR per branch against main; wait for all four CI runs to be green
```

Only the stage-2 failure was confirmed in advance. Any other cross-app test
that only breaks at an intermediate point shows up here, not in production.

---

## 2. Every stage, the same five steps

**When:** outside 02:30–05:00 IST. The nightly courier jobs run at 02:40,
03:50, 04:10 and 04:30 IST, and every stage restarts the API and portal
processes. Each stage takes about 15 min of CI plus about 10 min of deploy.

**2a. Record the money screen on production, BEFORE.** Use the old UI and an
account whose balance does not move: the QA accounts `qa-seller@skydrop.online`
and `qa-bot@skydrop.online` (both throttle sign-in at 5 per 15 min). Write down
the exact strings (e.g. `₹1,234.50`) or take a screenshot. §4 names the screen
per app.

**2b. Keep the running builds (about 20 MB each without their cache).**

```bash
ssh skydrop '
  S=~/rollback/$(date +%F-%H%M)-before-stage-N; mkdir -p "$S"
  cp ~/app/.last-deployed-sha "$S/"
  for a in track seller reseller admin; do
    rsync -a --exclude cache ~/app/apps/$a/.next/ "$S/$a.next/"
  done
  ls "$S"'
```

A `.next` folder is self-contained for this branch: no build requires
`@skydrop/*` at runtime (checked), and the branch changes no lockfile,
dependency, `public/` file, API, database, `packages/config` (security
headers), `ecosystem.config.cjs` or `deploy.sh`. That is what makes the
one-app rollback in §3 safe.

**2c. Move `main` (the owner's push).**

```bash
git push origin restyle-stage-N:main        # a fast-forward; CI → Deploy
```

Watch CI, then Deploy, for that exact SHA. `deploy.sh` ends by polling
`/health`, the three `/login` pages and track `/`. It writes
`~/app/.last-deployed-sha` only after all of them answer, so a green Deploy
means every port answered.

**2d. Smoke the stage's app (§4), then glance at the untouched apps.**

**2e. Verdict.** Green → next stage (same day or later; nothing forces the
pace). Red → roll that one app back (§3), leave `main` where it is, and do
**not** push again until the fix is ready. The next deploy rebuilds
everything from `main` and would overwrite the rollback.

---

## 3. Rolling back ONE app (the others keep running what they run)

### 3a. Instant: put the previous build back (about one minute, no git, no CI)

```bash
ssh skydrop '
  A=seller   P=3003          # track 3004 · seller 3003 · reseller 3005 · admin 3002
  S=$(ls -d ~/rollback/*-before-stage-N | tail -1)
  cd ~/app/apps/$A
  mv .next .next.restyle-failed
  cp -a "$S/$A.next" .next
  pm2 restart ~/app/ecosystem.config.cjs --only skydrop-$A --update-env
  sleep 8; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:$P/login'
```

For track, check `http://127.0.0.1:3004/` instead of `/login`. Only
`skydrop-<app>` restarts; no other process is touched. Put the new build
back the same way: swap `.next.restyle-failed` back into `.next` and restart
the same process.

**This rollback lasts only until the next deploy.** `deploy.sh` rebuilds
every app from `main`. Hold all pushes to `main` while an app is rolled
back, then either fix forward (preferred) or make it permanent with 3b.

### 3b. Permanent: one app back to the pre-restyle code on `main`

This is a normal commit through CI. It touches only that app's folder, plus
files added back for it:

```bash
git switch -c revert/<app> origin/main
git rm -r -q apps/<app>                              # drop files the branch ADDED too
git checkout 9fc408fa -- apps/<app>                  # the app as production ran it
# Phase 7 deleted legacy pieces that the OLD app code imports; restore them
# (adding them back changes nothing for the other apps):
git checkout 940e0d09^ -- packages/ui/src/tokens.css packages/ui/src/corridor.css \
  packages/ui/src/seller-theme.css packages/ui/src/components/app-shell.tsx \
  packages/ui/src/components/modal.tsx packages/ui/src/components/switch.tsx \
  packages/ui/src/components/ticket-handling-badge.tsx \
  packages/ui/src/components/index.ts packages/ui/package.json
```

Then fix the cross-app tests that read the reverted app's files, in the same
commit:

| Reverting | Tests elsewhere that read it | What to change |
|---|---|---|
| seller | `apps/admin/src/tests/wallet-topup.test.ts` (reads the seller wallet page) | back to the `['topups'` form (its `9fc408fa` version of that one assertion) |
| seller | `apps/admin/src/tests/auth-console-copies.test.ts` (requires seller on `SignInFrame`) | drop the seller block |
| seller or admin | `apps/seller/src/tests/unit-trace.test.ts` (reads seller AND admin unit trace) | none: it accepts either the badge or the chip |
| reseller | `apps/admin/src/tests/auth-console-copies.test.ts` (reseller block) | drop the reseller block |
| admin | `apps/admin/src/tests/*` come back with the folder at `9fc408fa`: the old `auth-console-copies` (expects byte-identical consoles in all three apps) and the old `wallet-topup` (expects the seller wallet's pre-Phase-3 tab code) | keep the CURRENT versions of those two files (`git checkout origin/main -- apps/admin/src/tests/wallet-topup.test.ts apps/admin/src/tests/auth-console-copies.test.ts`), then drop the admin block from `auth-console-copies` |
| track | none found | — |

The API unit specs that read frontend files (`order-charges-refund`,
`store-wallet-directions`, `admin-seller-wallet-overview`,
`courier-payout-account-link`, `emailed-urls-have-pages`) read routes and the
shared `@skydrop/ui/status` mappers, and neither changes with a revert. Run
the full gate (`pnpm -r typecheck`, `pnpm -r --if-present lint`,
`pnpm format:check`, both `scripts/check-*.py`, every unit suite) before
pushing. CI is the final word.

---

## 4. Smoke lists — ten clicks per app

Everything is **read-only on production**. Open a dialog to see it, then
Cancel. Never submit an order, top-up, withdrawal, approval or scan. Do each
list at 1440 px, then repeat clicks 1–3 at 390 px (phone width). Check both
themes on at least one page.

### Stage 1 — track (`track.skydrop.online`)

1. `/` loads on the brand skin; the map is visible; no sideways scroll at 390 px.
2. Theme switch changes light ↔ dark and survives a reload.
3. Enter a real, recent AWB → its page shows the journey **oldest → newest**.
4. On a long journey, "Show n earlier scans" folds and unfolds.
5. The language switch shows Hindi (Devanagari headings are semibold), then back.
6. An unknown AWB shows the single generic not-found page (TRK-8: no hint of why).
7. The AWB page source has `<meta name="robots" content="noindex…">`; `/` has none.
8. `/robots.txt` and `/sitemap.xml` answer with real content (no longer served by the AWB page).
9. DevTools console: no CSP violation, no hydration error.
10. **In place of a money screen** (public tracking shows no money by design, TRK-8): for two AWBs, the current status and number of scans match what you recorded in 2a.

Check the untouched apps too: the seller, reseller and admin sign-in pages
should look exactly as before. Admin carries one fix at this stage: after a
refused scan on the pack or handover bench is acknowledged, the scan field
has focus again (don't trigger a refusal on production to test it; the
specs pin it).

### Stage 2 — seller (`app.skydrop.online`, as `qa-seller`)

1. `/login`: the new frame with "seller portal", the theme switch works signed out, and a wrong password shows "Invalid email or password." word for word.
2. Sign in → dashboard: KPI tiles, sidebar, and the notification bell.
3. `/orders`: switch a status tab and search an order number; the list follows.
4. Open an order → timeline, money panel and status chips.
5. `/orders/new` opens (the van button is visible; **do not submit**) → Cancel.
6. **Money: `/wallet`.** The balance, the taka figure (if shown) and the first five ledger amounts are exactly the strings recorded in 2a.
7. `/wallet` → Top-ups tab → "Top-up wallet" opens the wizard → close it, sending nothing.
8. `/products` → open one product → its variants.
9. `/tickets` → open a ticket → the reply box shows the "n / 2,000" counter (don't send).
10. Settings → "Motion: reduced" → animations stop → set it back to Full; sign out.

Check the untouched apps: reseller and admin look as before.

### Stage 3 — reseller (`reseller.skydrop.online`, with a store login you hold)

1. `/login`: "store portal", the theme switch, and the wrong-password verdict word for word.
2. Dashboard: KPI money tiles and the shortcut cards.
3. `/orders`: status tabs and search.
4. `/orders/new`: the page renders (or shows the terms banner if terms are unaccepted); **do not place**.
5. `/catalogue`: the table, the "You pay" column, and search.
6. **Money: `/wallet`.** The balance and first ledger rows equal the strings recorded in 2a. If no store login exists, compare the same store's row on admin `/reseller-store-wallets` instead.
7. `/reports`: P&L lines expand.
8. `/tickets` → open one.
9. `/team`: pick another role for a member → a confirm dialog appears → Cancel (the role must NOT change).
10. `/account` → the Motion switch, then sign out.

Check the untouched app: admin looks as before.

### Stage 4 — admin (`admin.skydrop.online`, as `qa-bot`)

1. `/login`: "operations console", the theme switch, and the wrong-password verdict word for word.
2. Dashboard: attention queue, KPI tiles, the money tiles.
3. The header omnisearch finds an order number → order detail: timeline, charges, shipments.
4. **Money: `/seller-wallets` → the QA seller.** KPI figures and the first five ledger amounts equal the strings recorded in 2a. Also compare `/treasury` totals.
5. The seller-wallet tabs (Ledger / Top-ups / Withdrawals) switch at once (the Phase 6 transition fix).
6. `/withdrawals`: "Approve" on a row opens the confirm naming seller, amount and payee → **Cancel**.
7. `/warehouse/pack`: the scan field has focus and takes typing (**don't press Enter**); `/warehouse/handover` is the same.
8. `/call-center/queue`: change page; the list follows at once.
9. `/tickets` → a ticket: the paper-plane reply button and counter (don't send).
10. `/account` → the Motion switch and theme; `/settings` lists; sign out.

---

## 5. After all four stages

- Delete the rollback folders once each stage has run cleanly for a few days: `ssh skydrop 'rm -rf ~/rollback/*-before-stage-*'`.
- Merge or close the four `release/restyle-stage-N` PRs (their commits are already on `main`); delete the branches.
- `docs/delhivery-go-live-test.md` and the other docs are unaffected. `CLAUDE.md` FE-6 already describes the post-restyle estate.

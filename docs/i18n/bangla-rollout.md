# Bangla (bn) UI language: mechanism and rollout plan

Status: mechanism built and proven in `apps/associate` only (branch `feat/bangla-i18n`). Nothing else is translated yet. English is the default everywhere; a person opts into Bangla with the language switch.

This is the **UI language** (what the person at the keyboard reads). It is not `customers.preferredLanguage` (`en | hi`), which is the language of the SMS/notification sent to an **Indian customer**. The two axes never share a column, a cookie or a helper.

## 1. What exists now

### Mechanism (shared, additive, in `@skydrop/ui`)

| Piece | File | Notes |
|---|---|---|
| Server-safe core: locales, `sd-lang` cookie helpers, `langInitScript`, `{param}` formatter, `makeTranslator` | `packages/ui/src/app/i18n/index.tsx` | No `'use client'`. Must be `index.tsx`, not `.ts`: every app's `paths` entry for `@skydrop/ui/app/*` lists `index.tsx` then `index.ts`, and TypeScript 5.9 crashes (`Debug Failure` in `resolveExternalModule`) on a path-mapped `index.ts`. |
| Shared primitives' own words (en + bn) | `packages/ui/src/app/i18n/ui-messages.ts` | `bn` is typed `Record<keyof en, string>`: a key without Bangla fails to compile. |
| Provider, `useLocale`, `useTranslator`, `useUiT`, `richMessage`, `LanguageSwitch` | `packages/ui/src/app/i18n-client/index.tsx` (+ `language-switch.css`) | Default context is `en` with a no-op setter, so an app that mounts no provider renders exactly as before. |
| Bangla status words | `packages/ui/src/status/bn.ts`, wired into `statusLabel`, `ticketStatusLabel`, `uploadStatusLabel`, `deliveryActionStatusLabel` as an optional trailing `locale` argument | One `Record<Enum, string>` per enum, so the F2 rule holds: a new enum value fails to compile until it has a Bangla word. |

Shared primitives that now read the language from context: Shell, Pagination, FilterBar, PasswordField, ThemeSwitch, MotionSwitch, ErrorState, Dialog/ConfirmDialog/SuccessDialog, DropZone, TableToolbar, NumberStepper, TextField counter, SegmentedCode, Snackbar, both Toasts, ParachuteProgress, VanDriveOffButton, AsyncButton defaults, NotificationBell, `agoLabel`, `OtherPortals`. All default to English with no provider.

### How a language choice flows (same shape as the theme)

1. Choice is stored in cookie `sd-lang` (what the SERVER renders from) and `localStorage['sd-lang']` (survives a cleared cookie). Not HttpOnly (a client writes it, and a language is not sensitive); `SameSite=Lax`, one year, `Secure` only on https.
2. The root layout reads the cookie and renders `<html lang={locale} dir="ltr">`. The server must carry it: React 19's hydration-mismatch recovery resets `<html>` attributes to the server props, so a client-only `lang` would silently revert.
3. `langInitScript` is inlined in `<head>` WITH the CSP nonce (`x-nonce`) and `suppressHydrationWarning`. It repairs the cookie from localStorage and stamps `lang` before first paint.
4. On mount the provider compares localStorage to what the server rendered; if they differ it switches and refreshes. localStorage is the truth, as for the theme.
5. Switching: client components re-render at once from React state; `LocaleProvider`'s `onLocaleChange` (the app passes `router.refresh()`) re-runs server components against the new cookie. No reload, typed input is kept.

### App side (reference: `apps/associate/src/i18n/`)

- `messages/*.ts` — one file per feature, each entry `'key': ['English', 'বাংলা']`. English and Bangla sit on one line, so a message cannot ship without its pair.
- `catalog.ts` — merges the namespaces, exports `MessageKey` (a union of every key) and `CATALOGS`.
- `client.tsx` — `AppLocaleProvider`, `useT()`. `server.ts` — `getT()` for server components. `format.ts` — dates (`bn-BD-u-nu-latn`: Bangla month names, Western digits). `verdict.ts` — `serverVerdict` with our own sentences translated.
- Specs: `i18n-catalog.test.ts` (no duplicate keys, same `{placeholders}` in both languages, no Bengali digits), `i18n-status-words.test.ts`, `i18n-switch.test.tsx` (provider, switch, cookie, `<html lang>`, init script), `i18n-no-hardcoded-copy.test.ts` (reads sources; fails on any English literal in JSX text, copy props or toasts, and proves its own detector can fail).

### Never translated (enforced by convention + the specs above)

SKU codes, AWB/waybill numbers, order/batch numbers, enum VALUES, audit action strings, system-setting KEYS, API error CODES. Numerals stay 0-9 everywhere; money renders through `Money`, untouched. The server's `[CODE] message` verdict stays in the server's English (FE-2: the UI never paraphrases a guardrail), so in Bangla mode a refusal reads Bangla around an English server sentence. That is correct, but it is a visible seam; see section 5.

## 2. Scale (measured, not guessed)

Counted with the TypeScript AST over every non-test `.ts/.tsx` file: JSX text nodes, copy-bearing props (`label placeholder hint notice title description emptyTitle emptyBody aria-label alt note subtitle heading message …`), `{'literal'}` and ternary literals in JSX, toast calls, and copy-keyed object properties (`label:`, `title:`, `header:` …). "Unique" collapses repeats.

| App | Strings | Unique | Files with copy | JSX text | Props | JSX literals | Toasts | Object copy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| admin | 5551 | 4070 | 225 | 2047 | 2369 | 457 | 210 | 468 |
| seller | 3311 | 2278 | 128 | 1035 | 1458 | 242 | 95 | 481 |
| marketing | 925 | 761 | 77 | 329 | 200 | 45 | 0 | 351 |
| reseller | 1231 | 939 | 60 | 372 | 586 | 86 | 38 | 149 |
| associate | 378 | 294 | 27 | 112 | 191 | 23 | 5 | 47 |
| track | 8 | 6 | 4 | 0 | 1 | 0 | 0 | 7 |
| `@skydrop/ui` (excl. dev gallery) | ~120 | ~100 | n/a | | | | | |

The brief's crude counts (admin ~804, seller ~374, associate ~41) undercounted by roughly 7-9x. Plan against the numbers above.

Ten biggest single files:

- admin: `pnl/carry-forward/_components/carry-forward-index.tsx` 131, `warehouse/printing/_components/printing-station.tsx` 116, `cost-sync/_components/shiprocket-cost-section.tsx` 98, `warehouse/consignments/[id]/_components/consignment-panel.tsx` 80, `courier-wallet/_components/courier-wallet-index.tsx` 75, `courier-escalation/_components/courier-escalation-index.tsx` 71, `call-center/_components/call-center-station.tsx` 70, `expenses/_components/expenses-index.tsx` 67, `warehouse/receive/_components/receive-detail-view.tsx` 67, `reseller-store-wallets/_components/reseller-store-wallets-index.tsx` 65.
- seller: `reseller-stores/[storeId]/page.tsx` 133, `profile/page.tsx` 108, `orders/new/_components/new-order-form.tsx` 85, `reseller-stores/[storeId]/_components/store-catalogue.tsx` 83, `reseller-stores/requests/page.tsx` 83, `orders/_components/order-detail.tsx` 78, `inbound/_components/inbound-index.tsx` 77, `inbound/[id]/_components/consignment-detail.tsx` 75, `notifications/settings/_components/notification-settings-view.tsx` 72, `reseller-stores/reports/page.tsx` 72.
- reseller: `orders/[id]/page.tsx` 68, `reports/page.tsx` 68, `orders/new/page.tsx` 64, `integrations/page.tsx` 56, `reports/analysis/page.tsx` 54, `team/page.tsx` 49, `notifications/settings/_components/notification-settings-view.tsx` 47, `wallet/page.tsx` 44, `associates/[storeUserId]/prices/page.tsx` 43, `associates/analysis/page.tsx` 41.
- marketing: `components/micro/registry.tsx` 145, `content/site.ts` 141, `app/dev/swatches/page.dev.tsx` 73 (dev only), `components/landing/invite-form.tsx` 54, `components/islands/estimator-client.tsx` 43, `app/privacy/page.tsx` 41, `vignettes/team/index.tsx` 34, `vignettes/money/index.tsx` 28, `islands/reseller-stores-client.tsx` 27, `vignettes/stock-in/index.tsx` 25.
- track: 4 files, 8 strings (out of scope, see section 6).

What the counts do not include: strings the API sends (notification titles/bodies, topic names, `[CODE] message` verdicts, per-row import reasons), email/SMS templates, PDF and label text, and anything built by string concatenation. Those are separate workstreams (section 5).

## 3. Approach and why

Chosen: a small dictionary module in `@skydrop/ui` (cookie + provider + typed `[en, bn]` catalogues per app), no new dependency.

| | In-house dictionary (built) | `next-intl` | Per-app JSON |
|---|---|---|---|
| New dependency | none | yes, needs owner approval (MUST NOT #5) | none |
| Server + client components | yes (`getT()` / `useT()`) | yes, first-class | yes, if hand-wired |
| Switch without reload | yes (state + `router.refresh()`) | yes, but needs messages passed to a client provider and its request-config plumbing | whatever you build |
| CSP | one nonce'd inline script, same as the theme | no inline script needed, but its cookie-locale mode still needs the same pre-hydration care for `lang` | n/a |
| Type safety | keys are a TS union; `bn` must cover every key | via generated types, opt-in | none unless you add it |
| Plurals / ICU | not needed for en+bn (Bangla has no plural forms; we use `.one/.other` key pairs for English) | full ICU | none |
| Cost | ~200 lines, ours to maintain | upstream maintained, extra concepts (routing, middleware, request config) the consoles do not need because they have no locale in the URL | JSON loses compile-time key checking, which is the thing that catches the quiet failures |

The trade-off, stated plainly: we give up ICU plural/select syntax and upstream upkeep, and take on ~200 lines we own. That is the right side of the trade because (a) the only two languages are English and Bangla, and Bangla needs no plural rules; (b) the consoles keep the language in a cookie and not the URL, so next-intl's routing layer would sit unused; (c) the cookie + nonce'd pre-hydration script + server-rendered `<html lang>` is already a proven pattern here (the theme) and the new code is the same shape. **If** a third language with real plural rules (Hindi gender/plural agreement) ever lands, adopt next-intl then. This recommendation does not install anything.

Marketing is the exception: it is a public, indexable site, so it wants locale in the URL (`/bn/...`, `hreflang`) rather than a cookie. Use the same catalogue shape but route-based; that is the one place next-intl's routing would genuinely earn its place. Decide when the marketing phase starts.

## 4. Font blocker (must be resolved before any Bangla ships to production)

Finding: every console loads Plus Jakarta Sans and JetBrains Mono from committed **latin-subset** `woff2` files via `next/font/local`, with `unicode-range` pinned to Latin. **Neither family has Bengali glyphs at all** (the full upstream families cover Latin/Latin-ext/Vietnamese only). So Bangla text silently falls through the CSS stack to whatever the device has: Nirmala UI on Windows, Noto Sans Bengali on Android, Bangla Sangam MN on macOS/iOS usually exist, but many Linux desktops and some kiosk/warehouse browsers do not, and the result is tofu boxes or an unrelated serif.

What I did (no font added): in `apps/associate/src/app/globals.css`, `html[lang='bn']` overrides `--app-font` to put named Bengali system faces ahead of the generic families, loosens line-height to 1.65, and removes letter-spacing (tracking breaks conjuncts). Latin still renders in Plus Jakarta.

Recommendation (needs your approval, not done): commit one **Noto Sans Bengali** variable woff2 (SIL OFL, free), subset to Bengali + ZWNJ/ZWJ + dotted circle (`U+0980-09FF, U+200C-200D, U+25CC`), loaded with `next/font/local`, `display: 'swap'`, `preload: false`. Because `unicode-range` limits it to Bengali code points, the browser downloads it only on a page that actually contains Bangla, so English users pay nothing. Expect roughly 60-120 KB. Committed, not fetched, per the existing rule in each layout (CI must not depend on fonts.gstatic.com). For the monospace identifiers (SKU/AWB) nothing changes: they are Latin by rule. Alternative if you want less weight: **Hind Siliguri** (OFL, lighter, plainer). Either is a single new binary per app and a `unicode-range` declaration; it should land in `@skydrop/ui` as a shared asset only if you accept that `@skydrop/ui` changes restart every app.

## 5. Rollout plan, priority order

Order is by who reads Bangla: Bangladeshi sellers are the Bangla audience, so the seller console comes first; the admin console is staffed mostly in India (warehouse, call centre) and only the BD-facing slice of it justifies Bangla.

Effort below is relative to associate, which took one pass for the mechanism plus 378 strings / 27 files. "Agent effort" = drafting + wiring + specs; add a **native-speaker review** pass on every batch (budget ~100 strings/hour) because machine Bangla needs a human ear before customers see it. Do not ship a batch unreviewed.

0. **Done: associate** (378 strings, 27 files). Reference implementation.

0b. **Seller (client console): branch `feat/bangla-seller`.** ~2,900 catalogue entries in `apps/seller/src/i18n/messages/*.ts` (one file per feature). Both order-create forms share `orderNew.*`; the edit form owns `orderEdit.*`. Vocabulary modules (`consignment-words`, `role-words`, `package-type`) take an optional trailing translator that defaults to English (`@/i18n/english`). Money/status vocabularies were extended in `@skydrop/ui/status` (additive optional `locale`). Needs a native read, and finance sign-off for the ledger-direction words. Not translated: API-authored text (`[CODE] message`, notification bodies, journey milestone labels), `lib/*-hooks` thrown errors, `server-verdict.ts` (pinned), the dev gallery.

1. **seller (client console)** — 3311 strings (2278 unique), 128 files. Largest BD-facing surface. About 9x associate. Do it in feature slices, each a separate commit with its own catalogue file: (a) auth + shell + profile, (b) orders (list, new order form, detail), (c) inbound/consignments, (d) wallet/withdrawals, (e) reseller-stores admin screens (the three biggest files), (f) notifications settings. Reuse `@skydrop/ui` strings already done. Add the `i18n-no-hardcoded-copy` spec per slice (start with an allow-list of unconverted directories, shrink it as slices land) so the gate goes red on regressions.

2. **marketing** — 925 strings (761 unique), 77 files; `content/site.ts` and `micro/registry.tsx` hold 286 of them. Different mechanism (route-based locale, `hreflang`, translated metadata and OG tags, no dependence on a cookie for crawlers). The copy is brand voice, so this needs a human translator, not a mechanical pass. Do after seller so the sign-up funnel and the product the visitor lands in agree.

3. **reseller (member store)** — 1231 strings (939 unique), 60 files. Shares patterns with seller (orders, notifications settings, wallet). Lower than seller only because the audience is smaller and may be partly India-based; confirm with the owner before spending it.

4. **admin** — 5551 strings (4070 unique), 225 files. Largest, and the audience is mostly India-based staff. Recommend translating only the screens a BD person works in (client onboarding, tickets, inbound consignments approval) rather than the whole console; the money screens (P&L, carry-forward, courier wallet, treasury) should not be translated without finance sign-off because a mistranslated label on a money screen is a financial-control risk. Treat admin as optional and demand-driven, not a goal.

Cross-cutting work that does not fall out of per-app passes:

- **`@skydrop/ui` remainder** (~120 strings): `OrderJourney`, `StatusChip` callers, `Timeline`, `Stepper`, `Tooltip`, `KpiCard`, the remaining label functions in `status/index.ts` (`ticketTypeLabel`, `topupStatusLabel`, `freightModeWords`, `courierLabel`, wallet direction labels, store/reseller status labels). They are English-only until someone adds the `bn` table; `statusLabel` already covers the seven enums it unions.
- **API-authored text**: notification titles/bodies and topic labels, import row reasons, and the `[CODE] message` verdicts are written by the API in English. A Bangla console that shows English sentences from the server is the largest remaining seam. Options, cheapest first: leave verdicts verbatim (FE-2) and translate only notifications by adding a `locale` to the recipient and rendering the template server-side; or send a stable `messageKey` alongside every `{code, message}` so the UI can look up Bangla while still showing the code. Needs an API change and an owner decision; do not start it inside a UI pass.
- **`serverVerdict` copy drift**: `lib/server-verdict.ts` is pinned byte-identical across admin/associate/reseller/seller by `server-verdict.test.ts`, so translation lives in a wrapper (`i18n/verdict.ts`). Roll that wrapper out with the first slice of each app rather than editing the pinned file.
- **Moving the primitives**: `useT`, `AppLocaleProvider`, `getT`, `format.ts`, `verdict.ts` and `define.ts` are app-local copies today. When a second app adopts them, lift the generic parts (`define.ts`, `format.ts`) into `@skydrop/ui/app/i18n` in one additive commit.
- **Catalogue size**: each app imports both `en` and `bn` into the client bundle so a switch needs no network. Associate's 378 strings are negligible. At ~2300+ (seller) or ~4000 (admin) split the catalogue per route group (dynamic `import()` of the `bn` half on first switch) so English users never download Bangla and vice versa.
- **e2e**: `e2e-shared/csp.spec.ts` asserts zero CSP violations, which covers the nonce'd `langInitScript`; add one Bangla smoke per app (switch, reload, assert `<html lang="bn">` from the server HTML).
- **Docs**: add an `i18n.md` invariant to `docs/invariants/` once a second app adopts it, and an "I18N-n" line in `ui.md` (cookie name, never translate list, `index.tsx` rule).

## 6. Out of scope, deliberately

- **`apps/track`** is untouched. Its readers are Indian customers, for whom Bangla is the wrong language. Note it already has its own hand-rolled `en | hi` switcher (`lib/i18n`, cookie `lang`, reload-on-change) — a different axis from this work and a different cookie; they must not be merged.
- `customers.preferredLanguage` (`en | hi`) and the notification templates that read it.
- Email/SMS/PDF/label content.

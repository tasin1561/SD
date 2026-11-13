# Easy pages — the owner's standing rules for redesigned screens

Collected from the owner's instructions on 2026-11-12 and 2026-11-13. They apply to every page
the cloud session rebuilds (the lists in `AGENT_LOCKS.md`) and to any screen built after it.
Shared pieces live in `apps/admin/src/components/easy/`; dev-only test pages in
`apps/admin/src/app/dev/easy/` (run with `APPS_DEV_ROUTES=1`).

## The rules

1. **Nothing is lost.** Every feature, button, link, option, state and piece of information on the
   old page exists on the new one. Things may be ADDED. Inventory the page from its code (every
   conditional branch, not one screenshot) before changing it.
2. **Think like the person doing the job.** Work out what they do on this screen, in what order,
   with what in their hands (a phone on a call, a scan gun, a parcel), and put that first. Example:
   on the call bench the outcome form stays on screen beside the customer's details, because every
   call ended with a scroll to reach it.
3. **Any screen size.** 320px to desktop, portrait and landscape, no sideways page scroll, 44px
   touch targets, inputs at 16px on touch screens, nothing clipped. Every page must be workable
   from a phone, not just viewable.
4. **Light to look at.** White space, thin dividers instead of boxes, one accent colour plus the
   status colours, no glows or gradients, short text. Not messy.
5. **Plain words, readable by anyone.** No jargon or raw system words on screen (translate status
   enums). Never colour alone: an icon and a word go with it. Big figures for the numbers that
   matter. Someone who reads poorly should still be able to tell what state a thing is in and what
   to press.
6. **Explanations sit behind an "i".** Section explanations, what a label or number means, hover
   hints: `InfoButton`. Hidden until pressed, so the page stays clean. NEVER hide a warning, a
   deadline or anything the person must act on, and never hide the facts themselves.
7. **Say what each choice does.** Wherever a dropdown's options have consequences (a call outcome,
   a condition, a decision), put a `ChoiceGuide` under it: collapsed by default, listing every
   option with when to pick it and what happens next. The sentences mirror the server's rules and
   decide nothing.
8. **Instructions are hidden until needed**, and one press away when they are.
9. **Premium, quiet motion** (`premium-ui-motion`): transform/opacity only, no layout shift, off
   under reduced motion. The page must stay fast.
10. **Three languages.** English, Bangla and Hindi for every new string, written the way a person
    would say it.
11. **No Listen / read-aloud feature.** Built once, removed at the owner's request. Do not re-add.
12. **Detail pages count.** Every list page's `[id]` page is redesigned with it.
13. **Fix frontend bugs met on the way** (untranslated words, a date ignoring the language, a
    hover-only hint, an overlap). Backend problems are reported, not changed.

## The owner's page lists, in order

1. Operations and warehouse (31 pages, 2026-11-13) — in progress.
2. Money screens (seller wallets … FX) — after list 1; each shown to the owner before a push.
3. Administration (2026-11-13): `/settings`, `/system/capacity`, `/impersonation`, `/roles`,
   `/staff`, `/webhooks`, `/reports`, with every sub-page and detail page. Roles, staff and
   impersonation are screen-only: no permission, role or guard logic changes.

## How the work ships

- Screen-only: no changes to data fetching, endpoints, permissions or status logic.
- Scanner benches get tests pinning scan / Enter / focus BEFORE they are touched.
- Money screens are shown to the owner before each push (the repo's money rule). Everything else
  ships without review: test page, tests, CI, deploy, then a look at the live page; fix and repeat.
- On live data, look only. No action is confirmed on a real customer's order.
- `AGENT_LOCKS.md` and the two-agent protocol in `CLAUDE.md` apply. Check the LAST CI result on
  `main`, and that nothing is running, before every push.

## Progress (updated 2026-11-13)

Done and live: system issues, call centre (station, queue, awaiting, agents), re-attempt requests,
handover, pack / printing / receive / returns (phone rule and "i"; only pack and handover have a
full bench audit), courier decisions, manual placement, failed deliveries, needs attention, held
stock, who-has-what, dashboard, warehouse hub, orders list, tickets (list and detail), the five
stock screens, bins, consignments, and list 3 (settings, capacity, impersonation, roles, staff,
webhooks, reports).

Shared pieces in `apps/admin/src/components/easy/`: `InfoButton`, `ChoiceGuide`, `FilterPills`,
`When` (a date in the chosen language), and the `ez-touch` page rule in `easy.css`.

Still open:

- Money screens (list 2): not started. Each is shown to the owner before a push.
- Detail pages with dates still fixed to English: receive detail, consignment detail, bin contents
  summary, printing history line.
- Phone audits with real rows for the stock, warehouse and administration screens (their test
  pages use empty lists), and for the receive detail and returns inspection screens.
- Screens that ask for raw ids (stock transfer, new adjustment) and lists that show only ids
  (held stock) need API changes to be made friendly; reported, not changed.

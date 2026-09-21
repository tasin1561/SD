# Features coverage — one row per 3A bullet, and where the page shows it

3A is `platform.claims` in `src/content/site.ts` — the owner's verbatim list (2026-09-21). Every
bullet must be SHOWN on the page: a vignette beat, a checklist line or a section element. No
on-page claim may exceed 3A. Rebuilt in Phase 5 against the verbatim list; Phase 9 re-reads every
heading, promise, checklist line and caption against it.

Vignettes are `src/components/vignettes/<id>/`, their checklists `src/content/sections/tour-<id>.ts`.

## SELLER — Getting stock into India (tour · Stock in · teal)

| 3A bullet (verbatim)                                                                                                                                                                                                                                                                             | Shown by                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Declare a consignment: direct to India, or two-leg via your Dhaka intake (goods counted in BD, flown, counted again in India)                                                                                                                                                                    | beat `route` — "Straight to India" / "Via our Bangladesh warehouse" cards, badges Counted in Bangladesh → Left for India → Arrived in India; checklist 1                                             |
| Per-leg counts with variance recorded in both directions — a short count opens a ticket naming the leg; a surplus sends a notice. Neither blocks your stock                                                                                                                                      | beat `count` — leg table with −3 and +2, "Counted differently" ticket naming "Counted at our Bangladesh warehouse", banner "Nothing is blocked by it — your stock is what was counted."; checklist 2 |
| Cancel before dispatch (goods go back to you, recorded as returned — not written off)                                                                                                                                                                                                            | beat `cancel` — "Cancel consignment" dialog, "Returned — not written off" stamp; checklist 3                                                                                                         |
| Inbound freight billed three ways, your choice per seller or per consignment: pay now (on arrival), pay later (each unit's share taken as it's delivered), pay in advance (billed at the Dhaka count, before it flies). Rate agreed in taka or rupees and converted at the moment you're charged | beat `freight` — three-way bead, per seller ⇄ per consignment switch, ৳⇄₹ coin "converted at the moment you're charged"; checklist 4                                                                 |

## SELLER — Catalogue & inventory (tour · Stock on the shelf · violet)

| 3A bullet (verbatim)                                                               | Shown by                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products, variants, images (drag-and-drop), CSV import                             | beat `card` — drop zone, tiles, queued → uploading → registering → done, Variants, "Choose CSV…" / "Upload and check"; checklist 1                                                                                                                        |
| Live stock across warehouses, bins and batches; low-stock alerts                   | beat `register` — the seller's `/inventory` register (India stock · Reserved · Available · In transit · Low-stock) with the alert pulsing; checklist 2 carries the 3A words (bins and batches are Skydrop's, not on the seller's screen — owner decision) |
| STRICT mode: per-unit serials, scanned at pick and pack, with a discrepancy report | beat `strict` — switch on, scan line at PICK then PACK, "Unit discrepancies" → "Count mismatches"; checklist 3                                                                                                                                            |

## SELLER — Orders (tour · Orders · saffron)

| 3A bullet (verbatim)                                                                | Shown by                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Single entry, bulk CSV, or your own system via API key + webhooks                   | beat `intake` — New order / CSV import / Your own system (API key + webhooks) lanes into the Consignment monitor; checklist 1               |
| Full lifecycle timeline, edit, cancel                                               | beat `journey` — the eight-rung ladder with Skydrop / Courier owners, Edit order and Cancel; checklist 2                                    |
| Our call centre confirms every COD order by phone; you see each attempt and outcome | beat `calls` — "What we discussed with your customer": No response → Confirmed with the agent's note; checklist 3; also How it works step 2 |
| Customer list with per-customer order history and reputation                        | beat `register` — Customer register row: Orders · Delivered · RTO · Refused · Risk; checklist 4                                             |

## SELLER — Returns (tour · Returns · magenta)

| 3A bullet (verbatim)                                                                                                              | Shown by                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTO tracked to your warehouse; inspect per unit — two of an item can go different ways (restock / keep aside damaged / write off) | beats `back` (RTO initiated → RTO in transit → Received at our warehouse) and `inspect` (2 × Kurti: one to "Put back in stock", one to "Keep aside (damaged)", tray "Write off (not sellable)"); checklist 1–2 |
| Scrap and damage tickets opened automatically with the details, and refunds settled onto them                                     | beat `ticket` — TK-2026-… card with product / what we found / "We are keeping it aside for you", then the "Damage settlement" ledger row; checklist 3                                                          |

## SELLER — Money (tour · Money · green)

| 3A bullet (verbatim)                                                                                                              | Shown by                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wallet with a full ledger; top-ups against a bank transfer (checked by a human before crediting), withdrawals manual or automatic | beats `balance` (Balance · INR / Your balance in BDT, ledger rows COD collected · Order charges · Inbound freight), `topup` ("Waiting for Skydrop to see it" → person stamp → "Credited"), `withdraw` ("Automatic withdrawals" switch, "Withdrawals are yours to request." → "We raise the request for you on a schedule."); checklist 1–3 |
| COD credited on settlement, or Instant Pay at delivery for a fee                                                                  | beat `cod` — settlement chip vs Instant Pay chip "(Instant Pay fee applies)"; checklist 4                                                                                                                                                                                                                                                  |
| Charges broken down per order; GST invoices on delivered orders                                                                   | beat `order` — "Charges" band ("What this parcel costs you.") and "Invoice" band ("The tax document for this sale."); checklist 5                                                                                                                                                                                                          |

## SELLER — Running the business (tour · Your team · blue)

| 3A bullet (verbatim)                                                                                  | Shown by                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Team members with roles and permissions                                                               | beat 1 — Member register with role chips, Roles ("A role is a set of permissions."), permission switches; checklist 1 |
| Notification inbox plus email, silenceable per topic                                                  | beat 2 — "What reaches you" (per-topic, a person's own inbox) vs "The company's email" (per category); checklist 2    |
| Per-seller settings overrides — fee currency, courier choice policy, call-attempt caps, credit timing | beat 3 — "Your limits" ("Set by Skydrop — shown so a limit is never a surprise."), read-only rows; checklist 3        |

## RESELLER STORE — headline (section 14 · Reseller stores)

| 3A bullet (verbatim)                                                                                                                                              | Shown by                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A store sells your goods under its own name. The customer never sees you: the tracking page, the courier label and the emails all carry the store's name and logo | section sub ("Other businesses that sell your stock under their own name, with their own login."); card "The customer sees the store" |

## RESELLER — What you control

| 3A bullet (verbatim)                                                                                                                              | Shown by                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Which products a store may sell, and at what transfer price                                                                                       | demo beat 2 step ("Which products, at what transfer price…"); demo beat 4 store table column "You pay"                                      |
| How much stock it's shown — hide a share, or set units aside for it                                                                               | card "What the store sees"; demo beat 2 — "Hidden share (%)" and "Units set aside"                                                          |
| Versioned terms it must accept: which share of each Skydrop fee it pays, and when each of you gets credited                                       | card "Terms you set"; demo beat 1 — `{fee} — store pays (%)` rows, "Version 3", credit timings                                              |
| Per store, per task: may it recall a parcel, change an order, cancel, send back, chase us — and does it happen directly or wait for your approval | card "What the store may do"; demo beat 3 — all seven capabilities, "Can the Reseller store do this?" → "How?" Directly / Needs my approval |
| Auto-pause on a return rate you set; fraud signals surfaced to us                                                                                 | card "Guardrails"                                                                                                                           |

## RESELLER — What the store gets

| 3A bullet (verbatim)                                                                               | Shown by                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Its own login, team and permissions                                                                | card "Its own books"; demo beat 4 step ("Its own login and portal…")                                                                                            |
| A catalogue showing its price and its visible stock — never your cost, real stock, or other stores | demo beat 4 — store table Product · You pay · Sell between · Suggested · Available with "Your cost" / "Real stock" struck as hidden; card "What the store sees" |
| Orders by portal, CSV or API key; COD or prepaid from its wallet                                   | card "How it orders"                                                                                                                                            |
| Its own wallet, P&L and expense book                                                               | card "Its own books"                                                                                                                                            |
| Disputes with you, settled between your two wallets — never from ours                              | card "Disputes"; demo beat 5 — the two wallets, Skydrop's locked, "never from ours"                                                                             |

## Reseller capabilities — the plan's named mapping

3A's "Per store, per task" bullet names five tasks; the app has seven capabilities. The demo shows
all seven so it matches the seller's screen (`reseller.capabilities[].claims` records which are claimed):

| 3A task                      | App capability          |
| ---------------------------- | ----------------------- |
| recall                       | Call the customer again |
| change an order              | Change the order        |
| cancel                       | Call the order off      |
| send back                    | Send the parcel back    |
| chase us                     | Raise it with Skydrop   |
| — (shown, not claimed by 3A) | Answer "keep trying?"   |
| — (shown, not claimed by 3A) | Try delivering again    |

## Elsewhere on the page

How it works (steps 1–4), the track band's sample card, the estimator and the coverage checker
restate bullets above in courier terms; none claims more. Phase 9 checks every heading, promise
and caption against the tables here.

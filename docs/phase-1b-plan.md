# Phase 1B — Plan

## Reality check

The CLAUDE.md original Phase 1B list:

1. Seller wallet + ledger
2. GST-compliant invoicing
3. Payment gateway top-up
4. COD reconciliation
5. Cross-border remittance
6. Historical FX rate timeseries

For BD-seller → IN-customer cross-border, the actually-blocking items
are **wallet/ledger + COD reconciliation + remittance** — without
those, the seller can't get paid. The rest are "nice to have soon" or
genuinely Phase 2.

## What we'll build (in order)

| # | Module | Why it's needed | Scope |
|---|---|---|---|
| 19 | Profile editing | Seller currently can't update contact/whatsapp/etc.; the welcome flow assumes they can | PATCH `/seller/profile`; UI form on `/profile` |
| 20 | Bank account capture | Where remittances are sent. No actual integration yet, just data capture | `SellerBankAccount` table; CRUD endpoints; UI on `/profile` |
| 21 | Wallet + ledger primitive | The append-only books — every credit (COD delivered) / debit (shipping charge / GST / remittance) → one row | `seller_wallet_entries` table (append-only like stock_movements); `WalletService.credit/debit/balance` |
| 22 | COD accrual on delivery | When an order goes to DELIVERED, the COD amount minus our charges accrues to the seller wallet | Post-commit hook on the DELIVERED transition (similar to M11's `OrderLifecycleEventBus` listener); writes ledger entries |
| 23 | Admin remittance | Admin records "paid <X> to seller via bank reference Y on date Z"; ledger debits + remittance row | `Remittance` table; admin UI + endpoint |
| 24 | Seller wallet UI | Seller sees current balance + paginated ledger + per-order breakdown | Read endpoints + `/seller/wallet` page |
| 25 | Invoice generation (deferred-deferred) | GST-compliant PDF invoices. Not blocking; sellers can use the ledger CSV export instead | Out of scope for this batch — Phase 1C |
| 26 | Payment gateway top-up (deferred) | Only needed for PREPAID-heavy sellers; BD→IN COD is the dominant mode | Out of scope — Phase 2 |
| 27 | Historical FX timeseries (deferred) | Reports want it; not blocking | Out of scope — Phase 2 |

That's 6 modules: 19–24. ~3–5 days of focused work.

## Architecture decisions (locked before any code lands)

### W-1: Wallet entries are APPEND-ONLY (mirrors stock_movements / order_events / call_attempts / audit_logs)

`seller_wallet_entries` is the books of record. No UPDATE, no DELETE
path. A correction is a NEW entry with `direction=ADJUSTMENT_*` +
`linkedEntryId` pointing at the original.

### W-2: `WalletService.applyEntry()` is the ONE writer

Mirrors INV-1 (StockMutationService). Every credit / debit goes
through `WalletService.applyEntry(tx, input)`. The signature takes a
transaction client so callers compose into their own tx.

### W-3: Balance is COMPUTED, not stored

Mirrors INV-3:

```
balance = SUM(credit entries) − SUM(debit entries)
```

per `(sellerId, currency)`. A `seller_wallet_balances` cache table
exists for query efficiency but is RECOMPUTED from the ledger on every
write (post-commit). The ledger is authoritative.

### W-4: Per-currency wallets

Each seller has independent wallets per `Currency` (INR, BDT). Stock
+ orders are INR-canonical (existing convention). Remittance to a BD
seller is BDT — so a remittance is two ledger entries: debit INR +
credit BDT (FX-converted at the rate stamped on the entry).

### W-5: COD accrual on DELIVERED is the canonical entry path

Listener on `OrderLifecycleEventBus` (`to === DELIVERED`) writes two
entries inside a single tx:

- `credit: codAmountInr` (with `linkedOrderId` + `direction=COD_COLLECTION`)
- `debit: sum(orderCharges where chargeType in [BASE_SHIPPING,
  BASE_SURCHARGE_*, GST])` (with `linkedOrderId` + `direction=ORDER_CHARGES`)

Net effect: seller is credited (COD − charges). The order's charges
must already be persisted (M17 auto-compute fires post-commit on
order create, so they're populated by the time delivery happens).

### W-6: Remittance is admin-driven, manual reference

Phase 1B remittance is the admin entering a bank transfer reference
+ amount + FX rate snapshot. The remittance row links N ledger
entries (the FK target). No bank API integration; that's Phase 2.

### W-7: Bank accounts encrypted at rest

`seller_bank_accounts.account_number` + `routing_code` /
`swift_code` / `iban` are AES-256-GCM encrypted with
`BANK_ACCOUNTS_KEY_V1` env var (same shape as
`COURIER_CREDENTIALS_KEY_V1`). Audit row written on every decrypt.

The DISPLAY value (`accountNumberMasked` — last 4 digits) is stored
plaintext for the UI. The admin can reveal the full number with an
explicit click that audits HIGH.

### W-8: Phase-1A schema/system change is ADDITIVE

We add new tables + a `seller_wallet_entry` append-only model, but
DO NOT touch any existing table or invariant. Existing CLAUDE.md
rules (ORD-1..10, INV-1..9, etc.) are all preserved.

### W-9: No retro-active accrual

When wallet ships, EXISTING DELIVERED orders are NOT auto-accrued.
A one-off admin script does the backfill if/when ops decides. The
ledger starts CLEAN at the moment the listener goes live.

## Tasks (in dependency order)

### Module 19 — Profile editing

- Schema: nothing (uses existing `sellers` columns).
- Backend: `SellerProfileModule.update` — PATCH `/seller/profile`,
  body = `{ contactPersonName?, phone?, whatsapp?, displayCurrency?,
  displayLanguage? }`. Email is IMMUTABLE here (use auth flow to
  change). Audit row.
- Frontend: `/profile` page becomes editable; existing read-only
  shape becomes the "view" mode + a pencil-toggle gates the form.

### Module 20 — Bank account capture

- Schema: `SellerBankAccount` model
  - `id`, `sellerId` (FK, indexed)
  - `accountHolderName` (string)
  - `bankName` (string)
  - `branchName` (string nullable)
  - `accountNumberEnc` (bytea, AES-256-GCM)
  - `accountNumberMasked` (string, last 4 digits — plaintext for display)
  - `routingCodeEnc` (bytea — for IFSC IN / BD routing)
  - `swiftCodeEnc` (bytea nullable — for cross-border SWIFT)
  - `currency` (Currency enum — INR or BDT)
  - `isPrimary` (bool — exactly one primary per seller per currency,
    partial unique index)
  - `verifiedAt` / `verifiedByStaffId` (admin-marks-verified;
    Phase 1B doesn't auto-verify against bank)
  - `encryptionKeyVersion` (smallint, default 1)
  - `createdAt`, `updatedAt`, `deletedAt`
- Backend: `SellerBankAccountModule` — CRUD; AES-256-GCM via env key
  (mirror `CourierCredentialService`). Decrypt-with-audit endpoint
  for admin reveal.
- Frontend: `/profile` adds a "Bank accounts" section with add /
  edit / remove + the masked display. Admin sees a "Reveal" button
  with confirm.

### Module 21 — Wallet + ledger primitive

- Schema additions:
  - Enum `WalletEntryDirection`: COD_COLLECTION,
    ORDER_CHARGES, ADJUSTMENT_CREDIT, ADJUSTMENT_DEBIT, REMITTANCE_OUT,
    REMITTANCE_FX, OPENING_BALANCE.
  - `SellerWalletEntry` model — append-only
    - `id` (uuidv7)
    - `sellerId` (FK)
    - `currency` (Currency enum)
    - `direction` (enum)
    - `amount` (Decimal, always positive — direction encodes sign)
    - `runningBalanceAfter` (Decimal, denormalised — write-time snapshot)
    - `linkedOrderId` (FK to orders, nullable, indexed)
    - `linkedRemittanceId` (FK to remittances, nullable, indexed)
    - `linkedEntryId` (FK to self, nullable — for ADJUSTMENT correcting another entry)
    - `reasonCode` (enum — required on ADJUSTMENT_*)
    - `note` (text nullable)
    - `actorType` / `actorId`
    - `createdAt`
  - `SellerWalletBalance` cache model
    - `(sellerId, currency)` unique
    - `balance` Decimal
    - `lastEntryId`, `updatedAt`
- Service: `WalletService`
  - `applyEntry(tx, input): Promise<SellerWalletEntry>` — INV-1
    style sole writer.
  - `balanceLive(sellerId, currency): Promise<Decimal>` — reads ledger,
    no cache.
  - `balanceCached(sellerId, currency): Promise<Decimal>` — reads
    cache.
  - `recomputeCache(sellerId, currency)` — POST-COMMIT after every
    write (mirrors INV-5).
- No HTTP endpoint at this layer; consumed by 22 + 23.

### Module 22 — COD accrual on DELIVERED

- Subscriber on `OrderLifecycleEventBus` (FOURTH listener after
  NotificationListener / OutboundWebhookListener — same R3 wire).
- For `to === DELIVERED` AND `paymentMode === COD`:
  - Load order + charges (read-only).
  - In ONE tx via `WalletService.applyEntry`:
    - Credit COD amount as `COD_COLLECTION`.
    - Debit `BASE_SHIPPING + SURCHARGES + GST` as `ORDER_CHARGES`.
  - Post-commit recompute balance cache.
- Best-effort like M11 — a wallet write failure NEVER rolls back the
  transition.

### Module 23 — Admin remittance

- Schema: `Remittance` model
  - `id`, `sellerId`, `currency`, `amount`, `bankAccountId` (FK),
    `bankReference` (string), `paidAt` (date), `fxRateSnapshot`
    (Decimal nullable — for cross-currency), `staffId`, `note`,
    timestamps.
- Backend: `AdminRemittanceModule`
  - `POST /admin/remittances` — body: `{sellerId, currency, amount,
    bankAccountId, bankReference, paidAt, note?}`. Validates balance
    is sufficient (no negative wallet). Writes ledger entry +
    Remittance row + audit MEDIUM in one tx.
  - For BD-seller cross-currency: also writes a paired
    `REMITTANCE_FX` ledger entry on the IN-currency wallet.
  - `GET /admin/remittances` — paginated list.
- Frontend: `/admin/remittances` + a "Remit balance" button on the
  seller detail page that pre-fills the seller's primary bank
  account.

### Module 24 — Seller wallet UI

- Backend: `GET /seller/wallet` (returns balances per currency +
  pagination cursor for entries); `GET /seller/wallet/entries`
  (paginated ledger).
- Frontend: `/wallet` page with:
  - Balance card (BDT primary, INR secondary if non-zero).
  - Ledger table with filter chips (COD / Charges / Remittance /
    Adjustment), linked order column → opens order detail.
  - CSV export.

## Out of scope (explicit deferral)

- **Razorpay/Stripe top-up** — BD→IN COD is 95%+; PREPAID seller flows
  don't justify gateway integration yet.
- **Cross-border bank API (Wise / Razorpay X)** — admin manual entry
  + bank reference is sufficient for Phase 1B; automated payout in
  Phase 2.
- **GST-compliant PDF invoices** — sellers can pull a CSV from the
  wallet ledger for now. Invoicing lands when GST registration / tax
  compliance gets explicit attention.
- **Historical FX timeseries** — current rate (already in M16) is
  enough for reports / remittance snapshots.

## Estimated effort

| Module | Estimated build | Estimated test |
|---|---|---|
| 19 Profile edit | 1 hour | 30 min |
| 20 Bank account | 3 hours | 1 hour |
| 21 Wallet primitive | 4 hours | 2 hours |
| 22 COD accrual | 2 hours | 1 hour |
| 23 Admin remittance | 3 hours | 1 hour |
| 24 Wallet UI | 2 hours | 30 min |
| **Total** | **~15 hours** | **~6 hours** |

Sequenced in this order, the system becomes usable at module 22
(money flows in) and complete at 24 (seller sees their books).

---

If you approve this plan, I'll execute it in this order, committing
each module separately so deploys can ship them incrementally.

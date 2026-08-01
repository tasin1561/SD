# Skydrop — Testing & Modification Workflow

A practical guide to exercising every feature you've built and to safely
modifying the system. Read this in one sitting once; refer back per
section.

> **Convention used here**
>
> - `$` is your local WSL shell, in `/home/talha/projects/SD`.
> - `ssh skydrop "..."` runs a command on the production droplet.
> - `BANG` means paste into Claude Code (`! <cmd>`) for a one-shot.
> - Anywhere you see `<...>`, substitute your own value.

---

## 0. The landscape (read once)

### Live URLs

| Subdomain | Process | Port | Purpose |
|---|---|---|---|
| `skydrop.online` | skydrop-marketing | 3005 | Public marketing landing |
| `app.skydrop.online` | skydrop-seller | 3003 | Seller dashboard |
| `admin.skydrop.online` | skydrop-admin | 3002 | Internal staff |
| `track.skydrop.online` | skydrop-track | 3004 | Public AWB tracking (EN+HI) |
| `api.skydrop.online` | skydrop-api | 4000 | NestJS REST API |
| (no domain) | skydrop-workers | — | BullMQ consumer process |

### Identities

- **Admin/staff** logs in via `admin.skydrop.online/login` with a staff
  email + password. The seeded super-admin is `admin@skydrop.online`.
- **Seller** logs in via `app.skydrop.online/login`. Sellers are
  **invite-only** — no public signup. Admins create invitations.
- **Customer** never authenticates. They receive parcels and look up
  tracking on `track.skydrop.online/<AWB>`.

### Local dev (when you want to modify code)

```bash
$ docker compose -f docker/docker-compose.yml up -d   # Postgres + Redis + TimescaleDB
$ pnpm install                                        # workspace install
$ pnpm --filter @skydrop/db build                     # generate + compile db package
$ pnpm --filter @skydrop/db exec prisma migrate dev   # apply migrations to dev DB
$ pnpm --filter @skydrop/db seed                      # idempotent seed
$ pnpm --filter @skydrop/api start:dev                # api on :4000
$ pnpm --filter @skydrop/admin dev                    # admin on :3002 (separate terminal)
$ pnpm --filter @skydrop/seller dev                   # seller on :3003 (separate terminal)
$ pnpm --filter @skydrop/track  dev                   # track on :3004  (separate terminal)
$ pnpm --filter @skydrop/marketing dev                # marketing on :3005 (separate terminal)
```

In dev mode each frontend's `/api/[...path]/route.ts` proxy forwards
to `http://localhost:4000` (set via `API_ORIGIN` env).

---

## 1. End-to-end happy-path test

This is the **full lifecycle smoke**: invite → register → catalog →
receive stock → create order → call-confirm → pick → pack → manifest →
dispatch → track → deliver. Run it whenever you ship something
non-trivial. Takes ~15 minutes.

> **Where to run this**
>
> Prefer **production** so you exercise the real database + nginx +
> Cloudflare path. Use a test seller account (`tasin.sti+test1@gmail.com`
> works) so you can re-invite without polluting real accounts. Stub-
> mode Delhivery means AWBs look like `DLVSTUB...` — that's expected.

### 1.1. Admin: invite the seller

1. `admin.skydrop.online/login` → sign in as `admin@skydrop.online`.
2. **Sellers** → **Invitations** → **New invitation**.
3. Email: `<your-test-email>`, Company: `Test Co`.
4. Copy the invitation link from the success toast (also goes to the
   inbox via Resend).

### 1.2. Seller: register + log in

1. Open the invitation link in an incognito window.
2. Fill: full name, password (≥ 12 chars), phone (`+8801XXXXXXXXX`),
   country `BD`. Submit.
3. You're auto-logged-in on `app.skydrop.online/dashboard`.

### 1.3. (no manual approval step — the invite IS the approval)

Sellers register straight into `APPROVED` status — the admin already
vetted by sending the invite. The `Seller.status` column still exists
because admin can later `SUSPEND` / `REAPPROVE` a seller, but no
manual-approval action lives at registration time. Move on.

### 1.4. Seller: build a product-variant chain

1. **Catalog** → **New product**:
   - Name: `Test Widget`
   - Variant SKU: `TST-WIDGET-001`
   - Variant weight: `200 g` — set this. It picks the rate-card slab,
     and it is how an inbound freight bill gets split across a
     consignment.
   - Declared value: `₹ 500`
   - Save.

There is no category to file it under; that feature was removed on
2026-08-01.

### 1.5. Seller: ship stock → admin: receive it

#### Seller side: declare a goods-receipt

1. **Catalog** → variant detail page → (today this is admin-driven; for
   v1 use the API directly):
   ```
   POST /api/seller/goods-receipts
   {
     "warehouseId": "<seeded-warehouse-id>",
     "expectedArrivalAt": "2026-06-05T00:00:00Z",
     "lines": [{ "variantId": "<variantId>", "expectedQty": 10 }]
   }
   ```
   You can get the warehouse id from
   `https://api.skydrop.online/admin/warehouses` (admin token).

#### Admin side: receive it

1. `admin.skydrop.online/warehouse` → **Receive**.
2. Click the new pending goods-receipt → **Start receiving**.
3. For the line: received qty `10`, damaged `0`, putaway bin pick.
4. **Record all lines** → **Complete**.
5. The toast "Stock written" confirms `StockMutationService` fired a
   `RECEIPT +10` movement; `qtyOnHand=10`, `qtyReserved=0`.

### 1.6. Seller: create an order

1. **Orders** → **New order**.
2. Recipient: full name, `+91XXXXXXXXXX`, address with valid Indian
   state + PIN (try `Bengaluru / Karnataka / 560001`).
3. Item: pick the product + variant + qty `1`.
4. Payment: `COD`, amount `₹ 750`.
5. **Submit for confirmation** → toast confirms the order number
   (`SD-2026-XX-NNNNNN`) and it lands on the call queue.

### 1.7. Admin: confirm via call centre

1. `admin.skydrop.online/call-center` → **Pull next**.
2. The order's recipient + script appears. Click **Customer confirmed
   the order** → status → `CONFIRMED`, M5 reserves stock
   (`qtyReserved=1`, `qtyOnHand=10`).

### 1.8. Admin: pick → pack → manifest → dispatch

1. **Warehouse** → **Pick**. Pull next → you see the bin + qty.
2. **Start** → record each unit picked (just one in this test) →
   **Complete**. Order → `PICKED`.
3. **Warehouse** → **Pack**. Pull next → **Complete pack**. Order →
   `PACKED`; auto-attaches to a `DRAFT` manifest.
4. **Warehouse** → **Manifests** → click the `DRAFT` → **Close
   manifest**. Order → `PENDING_DISPATCH`; BullMQ enqueues AWB
   generation (stub mode returns `DLVSTUB...`).
5. After ~5 seconds, manifest → `CONFIRMED`, shipment has an AWB.
6. **Close manifest detail** → **Confirm dispatch handoff**. Order →
   `DISPATCHED`. `qtyOnHand -= 1` (now 9), reservation FULFILLED.

### 1.9. Customer: track on the public site

1. Open `track.skydrop.online` in any browser.
2. Paste the AWB → see the timeline (just one entry: "Dispatched").
3. Switch to **हिन्दी** in the top-right corner — page text + status
   labels translate. Cookie persists across the apex + AWB pages.

### 1.10. Drive tracking forward (manual scan path)

The real Delhivery webhook isn't wired (stub mode), so drive scans via:

1. **Admin order detail** → tracking section → **Add scan**. (or use
   POST `/admin/tracking/shipments/<shipmentId>/manual-scan`)
2. Scan: `IN_TRANSIT`. Refresh. Order is now in transit.
3. Repeat for `OUT_FOR_DELIVERY`, then `DELIVERED`.
4. Re-check track page — full timeline visible.
5. Re-check inventory — `qtyOnHand=9`, `qtyReserved=0` (TRK-7
   conservation: DELIVERED is stock-neutral).

**You've now driven a complete lifecycle.** Verify the receipt
+ persistence:

- **Admin order detail** → Charges section: `BASE_SHIPPING`,
  `BASE_SURCHARGE_COD`, `GST` should all have populated.
- **Notification logs**: SUCCESS rows for every Q5 milestone
  (CONFIRMED + DISPATCHED + OUT_FOR_DELIVERY + DELIVERED).
- **Outbound webhooks**: if a `SellerWebhookEndpoint` was active +
  subscribed, an `OutboundWebhookDelivery` row per milestone exists.

---

## 2. Alternate-flow tests

These prove the system handles edge cases. Run them after the happy
path passes.

### 2.1. Bulk order CSV upload

1. **Seller → Orders → CSV upload**.
2. Upload a CSV with 3 rows; one row missing PIN, one with an
   invalid SKU, one valid.
3. The error-row CSV downloads with the two failures + their codes;
   the valid row creates a `PENDING_CONFIRMATION` order on the call
   queue.
4. Re-upload the SAME CSV → the new copy of the valid row is REJECTED
   (`externalRef` already mapped — ORD-9 state-aware idempotency).
5. Re-upload with the valid row modified → the existing order PATCHES
   (still `PENDING_CONFIRMATION`).

### 2.2. NDR (no-response) → REJECTED_NDR

1. Create a fresh order → call-centre **Pull next**.
2. **No answer** (counts toward cap). Status → `CALL_NO_RESPONSE`.
3. Repeat. After the 3rd counting outcome, the order auto-routes to
   `REJECTED_NDR` (the cap is `ops.call_max_attempts_before_ndr` +
   the per-seller override). NO further queue entry created.
4. Reservation is NOT touched (pre-confirmation; nothing was
   reserved).

### 2.3. OUT_OF_STOCK fail-routing

1. Drain inventory: keep dispatching orders until a variant has 0
   on-hand AND 0 free.
2. Create a new order against that variant + submit.
3. Call-centre **CONFIRMED** → M5 reserve fails → order auto-routes to
   `OUT_OF_STOCK` (saga compensating release fires). The call attempt
   STILL records (CC-3); the final order status is `OUT_OF_STOCK`,
   not `CONFIRMED`.

### 2.4. RTO (return-to-origin) chain

1. Take a DISPATCHED order through scans to `OUT_FOR_DELIVERY` →
   `DELIVERY_FAILED` (NDR scan).
2. Drive another scan: `RTO_INITIATED` → `RTO_IN_TRANSIT`.
3. **Warehouse → RTO**. The parcel arrives. Click **Receive RTO**
   for the shipment → order goes to `RTO_RECEIVED` (the WMS-8 saga
   stamps `rtoReceivedAt`).
4. **Inspect** each item: condition `GOOD`. **Finalize disposition**
   → **RESTOCK**. Inventory: reservation RELEASED, `qtyOnHand` is
   unchanged (Model A: stock decrement happens at dispatch; restock
   re-adds via `RETURN_RESTOCK`). Final order: `RTO_RESTOCKED`.
5. Alternate WRITE_OFF: same flow but condition `DAMAGED` →
   **WRITE_OFF**. An `ADJUSTMENT_DECREASE` movement fires (reason
   `DAMAGED_IN_WAREHOUSE`); `qtyOnHand` stays at the dispatched-low
   level.

### 2.5. Sane admin cancel (matrix-guarded)

1. New order in `DRAFT` → admin order detail → **Cancel order**.
2. Reason: `wrong address`. Submit. Order → `CANCELLED_BY_ADMIN`.
3. Try cancelling a `DISPATCHED` order → server rejects:
   `[INVALID_TRANSITION] from DISPATCHED to CANCELLED_BY_ADMIN`
   (verbatim in the modal — FE-2 in action).

### 2.6. God mode (force-mutate)

1. Admin order detail → **Override** (red panel, only `SUPER_ADMIN`).
2. Read the gravity-escalating chrome: red borders → typed-confirm.
3. Stage: force `targetStatus = CONFIRMED` on a `DRAFT` order.
4. Reason: ≥30 chars. Tick risk-ack. Type literal `FORCE-MUTATE`.
5. Submit. Order's `hasAdminOverride` flag is set (permanent badge);
   the audit log carries the full before/after; reserve outcomes
   surface verbatim.

### 2.7. Outbound webhook delivery

1. **Seller → Settings → Webhooks → New endpoint**.
2. URL: `https://webhook.site/<your-token>` (free service, gives you
   a live URL).
3. Events: `order.confirmed, shipment.dispatched, shipment.delivered`.
4. Save. Copy the secret from the one-shot reveal card immediately.
5. Trigger an `order.confirmed` (via the happy-path 1.7).
6. On webhook.site, the POST arrives within seconds. Verify:
   - `X-Skydrop-Signature: sha256=<hex>` header present.
   - Body: `{ eventType, orderId, sellerId, from, to, occurredAt }`.
   - The signature matches `HMAC_SHA256(secret, body)`.

### 2.8. Manual courier placement (Delhivery rejected)

1. Drive an order to `PENDING_DISPATCH` with a PIN code Delhivery
   rejects (`999999` triggers stub-mode failure).
2. AWB job auto-supersedes the shipment to a new shipment in
   `CREATED` with `supersededAt` set on the old one. Order → routes
   to `PENDING_MANUAL_PLACEMENT`.
3. **Admin → Courier → Manual placement** → enter a manually-arranged
   AWB number → submit. Order → `DISPATCHED` (CUR-8 conservation-
   guarded: all reservations must be phase-2).

### 2.9. Seller DRAFT edit + discard

1. Seller creates a DRAFT (don't submit). Refresh.
2. Order list shows it. Click → **Edit** button visible (only on
   DRAFT / PENDING_CONFIRMATION).
3. Change recipient phone → **Save changes**. Server re-runs
   address validation; if PIN/state mismatch, FE-2 surfaces verbatim.
4. **Discard draft** → typed-confirm. Order soft-deletes.

### 2.10a. Wallet + COD accrual (Phase 1B)

1. After a COD order goes DELIVERED, switch to seller window →
   **Wallet** in the left nav.
2. Balance card shows INR > 0 (COD amount minus charges). BDT
   shows 0 until a remittance with FX conversion is recorded.
3. Ledger lists exactly TWO entries per delivered COD order:
   one CREDIT (COD_COLLECTION) and one DEBIT (ORDER_CHARGES),
   both linked to the same order id.
4. Click **Export CSV** → file downloads with the visible page's
   rows. Open in Excel/Sheets to verify.

### 2.10b. Admin remittance (Phase 1B)

1. Admin window → **Remittances** → **Record remittance**.
2. Pick the seller; source currency INR, bank currency BDT
   (cross-border default). Source amount = the INR balance from
   the wallet page. FX rate (e.g. 1.38). Destination amount =
   derived. Bank reference = your bank's payout id.
3. Submit. Validation errors surface verbatim (`[BANK_DETAILS_MISSING]`
   if the seller hasn't filled in their bank account; `[INSUFFICIENT_WALLET_BALANCE]`
   if source amount > balance).
4. Switch to seller window → /wallet → INR debit + BDT credit
   visible; the BDT balance equals source × FX.

### 2.10c. Admin reports (Phase 1B)

1. Admin window → **Reports**. Default date range = trailing 30 days.
2. Cards: Orders (confirm/NDR/RTO/delivery rates color-coded),
   Shipments (dispatch + delivery time averages), Wallet flows
   (COD collected, charges debited, remittances paid, net
   outstanding).
3. Change date range → numbers update.

### 2.10d. Admin webhook deliveries (Phase 1B)

1. Set up a seller webhook with `webhook.site/<token>` as the URL
   (Section 2.7).
2. Drive any order through CONFIRMED + DISPATCHED + DELIVERED.
3. Admin window → **Webhooks** → see the DELIVERED rows with HTTP
   200 + response time. Filter by status FAILED to find broken
   endpoints (e.g. wrong URL — 404, expired DNS — NETWORK_ERROR).

### 2.10d-bis. Webhook delivery retry button

1. Find a FAILED row in the Webhooks page.
2. Click **Retry** — the worker re-signs the payload with the
   endpoint's CURRENT secret + enqueues a fresh BullMQ job.
3. New attempt row appears.

### 2.10e. Admin FX rates + history

1. Admin → **FX rates** → click **Override** on a pair, enter new
   rate + reason ≥10 chars, save. `isManualOverride` badge appears.
2. **Timeline** → modal shows append-only history with ↑/↓ delta
   diff per change.

### 2.10f. Seller company logo

1. Seller → **Profile** → Logo section.
2. Choose JPG/PNG/WEBP ≤ 1 MB → presign → direct PUT → register.
3. Preview replaces immediately. **Remove** typed-confirm clears.

### 2.10g. Admin bank-account reveal

1. Admin → **Sellers** → seller detail → Bank-account section.
2. Enter reason → **Reveal**. HIGH audit row
   (`staff.seller.bank_account.revealed`) written BEFORE plaintext
   returns. Plaintext shown read-only with Copy button. Refresh
   clears.

### 2.10h. Seller invoice (GST PDF, Phase 1B)

1. Drive an order to DELIVERED (Section 1.10).
2. Seller → order detail → Invoice section auto-populates within
   seconds (`OrderDeliveredInvoiceListener` fires on the lifecycle
   bus). Open the PDF link — GST tax-invoice format with line items,
   IGST breakdown, place of supply, totals.
3. Manual regen via the **Generate now** button on a non-listened
   path; idempotent.

### 2.10i. Wallet CSV export-all + onboarding checklist

1. Seller dashboard → "Get started" card lists 4 onboarding steps
   (profile, bank, first product, first order); each strikes
   through as you complete it. Card auto-hides when all done.
2. Seller wallet with >50 entries: **Export CSV** button changes to
   "Loading all…" while it walks every page, then downloads the
   full ledger (not just visible page).

### 2.10. Public anti-enumeration

1. `track.skydrop.online/UNKNOWN-AWB-123` → generic "not found".
2. `track.skydrop.online/DLVSTUB-deleted-shipment` → SAME generic
   404 body (no signal leakage).

---

## 3. Modifying the system

### 3.1. Adding a backend endpoint

1. Find the relevant module under `apps/api/src/modules/<domain>/`.
2. DTO: add a class under `dto/`, annotated with `@ApiProperty` +
   `class-validator`.
3. Service: add the method; if it crosses module boundaries, use the
   sanctioned facade (e.g., `OrderWriteService.transitionStatus()`
   for order writes; `CatalogReadService` for variant reads).
4. Controller: thin (validation + dispatch); annotate with
   `@UseGuards`, `@requireStaffRoles`, `@ApiOperation`.
5. Re-export the response types into `packages/api-client/src/index.ts`
   (and write the endpoint type module under
   `packages/api-client/src/endpoints/<domain>.ts`).
6. Add a hook in `apps/<frontend>/src/lib/api-hooks.ts` wrapping
   `client.request<...>`.
7. Verify locally:
   ```bash
   pnpm --filter @skydrop/api typecheck
   pnpm --filter @skydrop/api lint
   pnpm --filter @skydrop/api test
   ```

### 3.2. Adding a Prisma model / column

1. Edit `packages/db/prisma/schema.prisma`. Follow naming conventions
   (PascalCase model, snake_case `@map`, plural table).
2. If you add an enum, also add it to `packages/db/src/enums.ts`
   (hand-maintained re-export).
3. From repo root:
   ```bash
   pnpm --filter @skydrop/db exec prisma format
   pnpm --filter @skydrop/db exec prisma validate
   pnpm --filter @skydrop/db exec prisma migrate dev --name <descriptive_slug>
   pnpm --filter @skydrop/db build
   ```
4. If the new table has FKs to existing entities, add a
   `reset<Module>State()` helper and chain it into the central e2e
   reset BEFORE the parent. See `apps/api/test/e2e/helpers/*`.
5. Hand-update `docs/db-schema.md` if the change is structural.
6. Commit migration files + schema.prisma + enums.ts together.

### 3.3. Adding a new order lifecycle status

1. Add enum value to `schema.prisma` `OrderStatus`.
2. Add to `packages/db/src/enums.ts`.
3. Migrate.
4. Update the state machine matrix in
   `apps/api/src/modules/order/services/order-state-machine.service.ts`
   — declare every valid transition FROM and TO the new value. The
   matrix' `never` switches will fail to compile until covered.
5. Update the four single-source mapping services if they should
   handle it (each F2-exhaustive switch over `OrderStatus`):
   - `CallOutcomeMappingService` (CC-2)
   - `TrackingStatusMappingService` (TRK-5)
   - `NotificationEventMappingService` (NOTIF-4)
   - `WebhookEventMappingService` (item #24)
6. Update FE-6 status-kind mapping in
   `packages/ui/src/status/order-status-kind.ts` so the badge
   colors render.
7. Update CLAUDE.md's ORD-1 28-status matrix description if the
   total count changes.

### 3.4. Adding a new translation key (track / future i18n)

1. Edit `apps/track/src/lib/i18n.ts`.
2. Add the key to the `Dict` type AND to BOTH `EN` and `HI`
   dictionaries — TS makes a missing entry a compile error.
3. Consume via `t(locale, 'newKey')`.

### 3.5. Adding a new webhook event code (sellers subscribe to)

1. Pick a stable code (e.g. `shipment.label_reissued`). Document the
   conditions under which it fires.
2. Map it in `WebhookEventMappingService.resolveForOrderStatus()` —
   the F2 switch.
3. The next deploy starts fanning out to any
   `SellerWebhookEndpoint.subscribedEvents` row that mentions the
   code. No DB migration.

### 3.6. Adding a frontend page

1. Create the route under `apps/<app>/src/app/(authed)/<path>/page.tsx`
   (server component entry that awaits `params` + renders a client
   `_components/<name>.tsx`).
2. The client component:
   - Hooks: `use<Domain>Detail`, `use<Domain>List` from `lib/api-hooks`.
   - Loading / error / empty states use `<LoadingState />` /
     `<ErrorState />` / `<EmptyState />` from `@skydrop/ui/components`.
   - Server-verdict errors: catch `ApiError`, format as
     `[CODE] message`, render in a critical-tint div. Mirror
     `webhook-create-fe2.test.tsx` for the pattern.
3. Link from the nav in
   `apps/<app>/src/app/(authed)/_components/authed-shell.tsx`.
4. If write-heavy, add a vitest:
   ```bash
   pnpm --filter @skydrop/<app> test
   ```

### 3.7. Running the worker locally

```bash
pnpm --filter @skydrop/api build           # produces dist/workers-main.js
pnpm --filter @skydrop/workers start        # node dist/workers-main.js
```

You don't need to also run `apps/api start:dev` for workers to
function — they only need DB + Redis. But the API server is what
HTTPS / triggers events. Run both.

### 3.8. Tailing droplet logs

```bash
ssh skydrop "pm2 logs skydrop-api    --lines 50 --nostream"
ssh skydrop "pm2 logs skydrop-workers --lines 50 --nostream"
```

Add `| grep -iE 'error|fail'` to filter.

---

## 4. Common operations

### 4.1. Rotating credentials (after sharing them)

| Credential | How |
|---|---|
| Staff password | Admin → Sellers/Staff → user → Reset password |
| Resend API key | `dashboard.resend.com` → API Keys → revoke + create; update `RESEND_API_KEY` in droplet `.env`; `pm2 restart skydrop-api skydrop-workers --update-env` |
| Cookie signing key (JWT_SIGNING_KEY) | Generate new 32-byte random hex; set in `.env`; restart api+workers — invalidates ALL active sessions |
| Courier credentials | `courier_credentials` table; encrypted at rest with `COURIER_CREDENTIALS_KEY_V1` |

### 4.2. Promoting a code change to production

The standard path is just push to `main`:

1. Local: `git push origin main`.
2. GitHub Actions → CI runs (typecheck + lint + unit + e2e against
   `skydrop_test`). Takes ~7 min.
3. On CI success → Deploy workflow runs:
   - SSH to droplet
   - `git pull` + `pnpm install --frozen-lockfile`
   - Build all 5 apps + build the workers-main entry
   - `prisma migrate deploy` (idempotent)
   - `pnpm seed` ONLY if seed.ts or schema.prisma changed
   - `pm2 restart` ONLY the processes whose code changed
   - Smoke each port (15 × 2s) before reporting success
4. Watch via `gh run watch <run-id>` or
   `gh run list --limit 3`.

### 4.3. Rolling back

If a deploy goes bad:

```bash
ssh skydrop
cd ~/app
git log --oneline | head            # find the prior good SHA
git reset --hard <prior-SHA>        # NEVER from main; only on droplet
pnpm install --frozen-lockfile
pnpm --filter @skydrop/api build
pm2 restart skydrop-api skydrop-workers --update-env
```

Then `git revert <bad-SHA>` LOCALLY + push. Don't `git push --force`
to main from the droplet's reset state.

### 4.4. Manual DB poke (read-only by default)

```bash
ssh skydrop "psql \$DATABASE_URL -c 'SELECT count(*) FROM orders;'"
```

For writes, prefer the admin UI or a dedicated migration. If you must
write directly, wrap in `BEGIN; ... COMMIT;` and audit the change
with a `staff.manual_db_write` HIGH audit row.

### 4.5. Re-running a failed BullMQ job

```bash
ssh skydrop "pm2 restart skydrop-workers"      # nudges queues
```

For a specific stuck job, the BullMQ board (deferred to Phase 1B)
will help. For now, identify the queue + jobId in logs and use:

```sql
-- check failure
SELECT * FROM outbound_webhook_deliveries
WHERE status = 'FAILED' AND created_at > now() - interval '1 hour';
```

### 4.6. Testing a new release before pushing

```bash
pnpm --filter @skydrop/api test                    # unit (988 tests, ~30s)
pnpm --filter @skydrop/api test:e2e                # e2e (99 tests, ~2 min, needs Docker)
pnpm --filter @skydrop/admin test                  # vitest (7 tests)
pnpm --filter @skydrop/seller test                 # vitest (5 tests)
pnpm e2e:fe                                        # Playwright (6 specs, needs all FE running)
```

Each runs ~independently. CI runs all of them.

---

## 5. Where to look next

| You want to... | Read |
|---|---|
| Understand a service-layer rule | `CLAUDE.md` § "Service-Layer Rules" — all invariants codified |
| Understand the schema | `docs/db-schema.md` |
| Know what's deferred | `docs/phase-1a-debt.md` |
| Set up CI/CD from scratch | `docs/cicd.md` |
| Install ChatWoot | `docs/chatwoot-selfhost.md` |
| Find a feature's code | `grep -rn '<feature>' apps/ packages/` |
| Find an HTTP endpoint | Swagger at `https://api.skydrop.online/api/docs` (dev mode only — disable for prod by setting `NODE_ENV=production`) |

When stuck: search `CLAUDE.md` for the invariant tag (e.g. `WMS-7`,
`TRK-5`) — every locked decision has one. The tag tells you what the
rule is AND why it exists.

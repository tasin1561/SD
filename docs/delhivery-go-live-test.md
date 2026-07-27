# Delhivery go-live test — one real parcel, then cancelled

**Status:** not yet performed.
**Who runs it:** the founder, or a SUPER_ADMIN sitting next to them.
**How long:** about 40 minutes, most of it waiting.

---

## What this test is for

Every Delhivery call Skydrop makes has been built and unit-tested, and the
read-only ones have been verified against the live production API. **No write
has ever reached Delhivery's servers.** There is no sandbox on this account, so
the only way to find out whether our marshalling is right is to do it once, on
purpose, watching.

This procedure creates exactly one real consignment, confirms Delhivery
accepted it, then **cancels it before anything physically moves**. Nothing
ships. No van is summoned. No customer is contacted.

### What it proves

- The credential decrypts and authenticates against the live API.
- The waybill pool can fetch real AWB numbers.
- Our create-shipment payload is shaped the way Delhivery expects — the single
  biggest unknown, since the wire format was reverse-engineered from their
  docs rather than validated.
- The registered pickup-location name matches exactly (a mismatch rejects the
  manifest, and this is the cheapest place to discover it).
- Cancellation works, which is the safety net for everything else.
- Our HTTP-200-with-`Success:false` interpretation is correct on a write.

### What it does NOT prove

- Delivery, tracking scans, NDR handling, or pickups. Those need a parcel that
  actually travels.
- Anything about the label PDF beyond it being fetchable.
- The webhook path — no scans are generated for a cancelled consignment.

---

## Hard rules

Three things must NOT happen during this test. Each one turns a test into a
real shipment.

1. **Do not request a pickup.** That is the call that sends a van to the
   warehouse. It is a separate action (`/warehouse/pickups`) and nothing in
   this procedure needs it.
2. **Do not confirm dispatch handoff.** That marks the parcel as physically
   given to the courier. The manifest close is enough to generate the AWB.
3. **Do not leave `courier.delhivery_live_writes_enabled` on.** It is the only
   thing standing between a bug and a real parcel. Turning it off again is step
   9, not an afterthought.

One more, less obvious: **the waybill this test consumes is spent forever.**
AWB numbers are never reused — that is a deliberate invariant (CUR-9), because
two parcels on one tracking identity is unrecoverable. Expect to burn one
number. That is the cost of the test.

---

## Pre-flight

Work through these before enabling anything. Every one is a thing that would
otherwise fail mid-test with the guard already on.

### 1. Credential is loaded

- `COURIER_CREDENTIALS_KEY_V1` is set in the droplet's environment (the key is
  **never** in the database).
- A `CourierAccount` exists for `delhivery` / `PRODUCTION`, added via
  **Admin → Courier accounts**, with the API token in `credentialFields`.
- The token is the live one. If it has been rotated since it was stored, store
  the new one — decryption succeeding proves nothing about whether Delhivery
  still honours it.

### 2. Settings are configured

Admin → Settings. All four must be right; the first three are read on every
shipment.

| Key | What it must be |
|---|---|
| `courier.delhivery_api_base_url` | The live base URL. **Empty means STUB MODE** — the whole test would pass without touching the network and prove nothing. Check this first. |
| `courier.delhivery_pickup_location` | The warehouse name **exactly** as registered with Delhivery. Case and spaces included. |
| `courier.delhivery_origin_pincode` | The pincode goods dispatch from. |
| `courier.delhivery_waybill_pool_refill_batch` | **Set this to 25 for the test.** It defaults to 500, and pulling 500 real waybills as your first live write is a large, pointless first action. Delhivery mints in batches of 25 anyway. Put it back afterwards. |

### 3. Confirm you are actually in live mode

**Admin → Delhivery** shows a `Live API` or `Stub mode` badge. If it says
Stub mode, the base URL is unset and nothing below will reach Delhivery. Stop
and fix that first — a "successful" test in stub mode is the worst possible
outcome, because it looks like proof.

### 4. Pick the test order

Create a real order through the normal seller or admin flow, with:

- **A destination address you control.** Your own address. If cancellation
  fails and the parcel ships, it must arrive somewhere harmless.
- **Low declared value.** Under ₹50,000, so no e-way bill is required and that
  variable stays out of the test.
- **Prepaid, not COD.** A COD parcel that escapes the test involves collecting
  money from someone.
- **One line, one unit.** Fewer moving parts.

Take it through the normal lifecycle to PACKED: confirm → pick → pack. None of
those touch Delhivery.

---

## The test

### Step 1 — Enable live writes

Admin → Settings → `courier.delhivery_live_writes_enabled` → **true**.

From this moment the system can create real consignments. Everything from here
to step 9 is time-boxed; do not walk away.

### Step 2 — Fill the waybill pool

Admin → Delhivery → **Refill waybill pool**.

Expect: `Fetched 25. Pool now 25.` and the *Usable now* stat rising to 25 after
the settle delay (two minutes by default — Delhivery warns a freshly-minted
waybill can error if used immediately, which is what the delay is for).

If this fails, stop. Everything downstream needs a waybill, and a failure here
is a credential or connectivity problem, not a marshalling one.

**Rate note:** the bulk waybill endpoint allows five requests per five minutes,
budgeted to four. Do not press the button repeatedly — a WAF 403 blocks the
whole egress IP, taking any other live traffic with it.

### Step 3 — Manifest the parcel

Admin → Warehouse → Manifests. Find the DRAFT manifest holding your packed
shipment and **Close** it.

Closing enqueues AWB generation. This is the real test: the create-shipment
call goes to Delhivery with our payload.

### Step 4 — Confirm the AWB is real

Wait ~30 seconds, then open the order.

Expect: an AWB number on the shipment, and the order in `PENDING_DISPATCH`.

**Verify it is genuinely theirs, not ours.** Log into Delhivery One and search
the AWB. It should appear as a manifested consignment with your destination
address. If it appears in our database but not in their panel, the create
silently failed — check `audit_logs` for `courier.awb.*` rows and the API logs
for a 200 response carrying `Success: false`, which is Delhivery's house style
for a rejection and the trap most likely to bite here.

### Step 5 — Fetch the label

Order detail → the shipment's **Courier actions & costs** panel.

The label should have been fetched and uploaded to our Spaces bucket during
AWB generation. Confirm an `awb_labels` row exists and the PDF opens. A missing
label is not fatal — the AWB persists first, deliberately — but note it.

### Step 6 — Read the lane back

Same panel: **expected transit** and **courier cost** should populate from the
live API. Sanity-check the cost against what you expect to pay. This is also
the first live read on a real consignment rather than a hypothetical lane.

---

## Cancelling

### Step 7 — Cancel with the courier

Order detail → **Courier actions & costs** → **Cancel with courier**. Give a
reason: *"Go-live verification, parcel never handed over."*

**What cancellation actually does, by state:**

| Delhivery state | Result of cancelling |
|---|---|
| Manifested (where this parcel is) | Stays Manifested. **Nothing was collected, so nothing moves.** This is the clean case. |
| In Transit / Pending | Becomes a **return** — it does not vanish, it comes back to us at the cost of a return leg. |
| Dispatched, Delivered, RTO, Lost, Closed | Refused outright. |

Because the parcel was never handed over, this is the clean case. That is the
entire reason the hard rules forbid a pickup request and a handoff confirm.

### Step 8 — Confirm the cancellation took

Check Delhivery One again: the consignment should show as cancelled.

Do not skip this. The cancel call returns HTTP 200 whether or not it worked —
the body carries the verdict. Our code reads the body, but this test exists
precisely to check that our reading is right, so verify independently.

### Step 9 — Turn live writes back OFF

Admin → Settings → `courier.delhivery_live_writes_enabled` → **false**.

Also restore `courier.delhivery_waybill_pool_refill_batch` to 500.

Confirm on Admin → Delhivery that the guard reads **Live writes blocked**.

### Step 10 — Clean up our side

The order is still `PENDING_DISPATCH` with an AWB, and stock is still reserved.
Cancel it: **Admin → order detail → cancel**, which transitions to
`CANCELLED_BY_ADMIN` and releases the stock reservation.

Verify `qtyOnHand` and `qtyAvailable` are back where they started. Stock
conservation across this whole path is the invariant most worth checking after
any first-time write.

---

## Afterwards

Record what you found. Specifically:

- Did the create payload work first time, or did Delhivery reject something?
- Whatever it rejected is a `TODO(delhivery-api)` seam that was wrong. Fix it,
  then re-run this whole procedure — not just the failed step.
- Note the AWB you burned, so a later audit does not mistake it for a lost
  parcel.

**Then update `docs/delhivery-integration.md`**: the seams this test exercised
stop being assumptions and become verified facts, and the next person needs to
know which are which.

### What becomes unblocked

Once the write path is proven, two things that are deliberately not built yet
become reasonable:

- **The nightly NDR sweep.** Delhivery advises firing re-attempt requests after
  21:00 IST, once the day's failed parcels are physically back at the facility.
  A cron is the right shape; automating it before the contract was proven would
  have been automating a guess.
- **Real seller traffic.** Until this test passes, every dispatch is a first
  dispatch.

---

## If something goes wrong

**The parcel ships anyway.** It goes to your address. Accept it, and treat the
cancellation failure as the finding — it means our reading of their cancel
response is wrong, which is a genuine bug worth having found this way.

**A call hangs or times out.** Do not retry blindly. Check Delhivery One for
what actually landed; a timeout after they accepted looks identical to a
timeout before. This is the same reasoning behind pickup requests keeping their
day claimed on failure.

**You get a 403.** That is the WAF, not an auth failure, and it blocks the
whole egress IP. Stop, wait five minutes, and check Admin → Delhivery for the
remaining rate budget before trying again.

**Anything unexpected.** Turn `courier.delhivery_live_writes_enabled` off
first, diagnose second. The guard is the emergency stop, and every blocked
attempt while it is off writes a HIGH audit row — so you will be able to see
exactly what tried to fire.

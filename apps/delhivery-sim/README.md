# Delhivery simulator

A fake Delhivery that speaks the real wire API, so the **real** adapter
code path can be run end to end without manifesting a real parcel.

## Why this is not the same as stub mode

The adapter already has a stub mode, and every test to date has run
against it. Stub mode short-circuits **inside the process**, which means
the real branch — the HTTP client, request marshalling, the auth header,
response parsing, retries, rate limiting — has never executed once. That
is most of the integration surface.

It also cannot make a parcel *move*. The entire tracking lifecycle
arrives as webhooks from the courier, and the interesting behaviour lives
downstream of a scan: the monotonic-forward guard, the NDR
`delivery_attempts` row, the RTO boundary, the wallet accrual at
DELIVERED. None of it can be exercised without something playing the
courier.

## What it cannot tell you

**This encodes our belief about Delhivery's wire format.** Where that
belief is wrong, the simulator is wrong the same way and agrees with us.
A green run here proves our orchestration is self-consistent — not that
Delhivery agrees.

Only a real parcel proves that. This makes our own bugs cheap to find;
it does not replace `docs/delhivery-go-live-test.md`.

## The one-command run

```bash
pnpm --filter @skydrop/delhivery-sim start   # terminal 1
pnpm --filter @skydrop/api start:dev         # terminal 2
pnpm sim:e2e                                 # terminal 3
```

`scripts/sim-e2e.ts` goes from an empty dev database to two finished
parcels and asserts the result: one delivered, one refused and returned
and put back on the shelf. It seeds the staff user, the seller, the
stock and the courier credential; drives pick, pack, manifest close and
dispatch handoff; fires the scans; and checks that the delivered parcel
left nine units on hand and the restocked one ten.

Two bits of local setup it cannot do for you, both in `apps/api/.env`:

```
TRACKING_WEBHOOK_SECRET_DELHIVERY=devsimsecret   # same value the sim gets
COURIER_CREDENTIALS_KEY_V1=<64 hex chars>        # any value locally
DEV_MOCK_SPACES=true                             # or label upload fails,
                                                 # and the manifest never
                                                 # reaches CONFIRMED
```

## Running it manually

```bash
# 1. start the simulator
PORT=4010 \
SKYDROP_API_URL=http://localhost:3000 \
TRACKING_WEBHOOK_SECRET_DELHIVERY=<same value the API has> \
pnpm --filter @skydrop/delhivery-sim start

# 2. point the API at it, and allow writes
#    (admin → Settings, or directly in system_settings)
courier.delhivery_api_base_url    = http://127.0.0.1:4010
courier.delhivery_live_writes_enabled = true
```

Turning live writes on is safe **because the target is a simulator**.
The write guard checks the host: loopback and private addresses are
recognised as a simulator and pass silently; anything else counts as
production and is audited at HIGH with the hostname. An unrecognised or
unparseable URL is treated as production, because that is the expensive
direction to be wrong in.

To go back to the in-process stub, blank `delhivery_api_base_url`.

## Driving a parcel

```bash
# what exists
curl -s localhost:4010/_sim/parcels | jq

# move one — each advance fires a SIGNED webhook at the API
curl -s -XPOST localhost:4010/_sim/parcels/<AWB>/advance \
  -H 'content-type: application/json' -d '{"stage":"IN_TRANSIT"}'
```

Stages: `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `NDR`,
`RTO_INITIATED`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`, `LOST`, `DAMAGED`,
`CANCELLED`. Add `"note"` to set the NDR reason text.

A happy path is `IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`. A failed
delivery is `… → NDR`, and repeating `OUT_FOR_DELIVERY → NDR` exercises
the retry cycle. A return is `NDR → RTO_INITIATED → RTO_IN_TRANSIT`; the
warehouse receives it from there, because a webhook is deliberately not
allowed to drive `RTO_RECEIVED` (TRK-6).

`POST /_sim/reset` clears everything. So does restarting it — state is
in memory on purpose, so "is this left over from yesterday?" is never a
question worth asking.

## Destination pins that misbehave

Mirrors the in-process stub, so a scenario behaves the same either way:

| Pin      | What happens                                                    |
| -------- | --------------------------------------------------------------- |
| `000000` | Non-serviceable — empty `delivery_codes`, create returns `success:false`. Permanent: the shipment is superseded and the order routed to manual placement. |
| `999999` | Transient — the create returns a 500, which is retryable. The order stays CONFIRMED and manifest close retries. |
| anything else | Serviceable. |

## Endpoints implemented

`/api/cmu/create.json` · `/c/api/pin-codes/json/` ·
`/waybill/api/bulk/json/` · `/api/p/packing_slip` · `/api/p/edit`
(edit + cancel) · `/api/p/update` (NDR action) · `/fm/request/new/`
(pickup) · `/api/backend/clientwarehouse/{create,edit}` ·
`/api/v1/packages/json/` (tracking) · `/api/dc/expected_tat` ·
`/api/kinko/v1/invoice/charges` · `/api/rest/ewaybill/:awb` ·
`/api/cmu/get_bulk_upl/:id`

Anything unrouted answers 404 and logs `UNHANDLED <method> <path>` —
which is how you find out the adapter calls something this does not yet
speak.

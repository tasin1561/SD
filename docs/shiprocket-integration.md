# Shiprocket — access, account state, and what is actually blocking

Companion to `docs/delhivery-integration.md`.

> **CORRECTED 2026-09-19 — SHIPROCKET IS LIVE ON PRODUCTION.**
>
> This file opened by saying the wire contract "has not been" validated
> and that everything here "has never made a real call", and further down
> that production was "inert again" with an empty base URL and live
> writes off. **None of that is still true.** Checked against the
> production database: `Courier.isActive` is TRUE, the base URL is
> `https://apiv2.shiprocket.in`, and
> `courier.shiprocket_live_writes_enabled` is TRUE. Failover from
> Delhivery reaches Shiprocket for real (CUR-14), without anybody
> choosing it per parcel.
>
> **Reason about the posture from the DATABASE, never from this file.**
> The two questions are `courier.shiprocket_live_writes_enabled` and
> `courier.shiprocket_api_base_url`, and `/shiprocket` in the admin app
> now shows both (it was built on 19 Sep precisely because the courier
> failover can reach had no page).
>
> What is STILL unproven on the wire is the RETURN leg
> (`/orders/create/return`, built 19 Sep): no return has been booked on
> this account, so its request shape is their documented one rather than
> an observed one.

Sourced from the founder's setup notes (2026-09-08) and re-checked
against the code and the production database on the same day; the state
section below was corrected on 2026-09-19. No credentials here, or
anywhere in the repo — see "Credentials" below.

---

## The two surfaces behave differently, and only one blocks us

**The seller panel (`app.shiprocket.in`) is geo-restricted.** From
Bangladesh it loads and then the Continue button does nothing — no
network request fires at all. The console shows a `TypeError` inside a
randomly-named anti-bot bundle: the bundle loads but a sub-resource it
needs is refused at the edge for a non-Indian IP, so its initialisation
never finishes and the submit handler throws before it can send
anything. Reproduced in a clean profile with no extensions; works
through an Indian IP.

**The API (`apiv2.shiprocket.in`) is NOT geo-restricted.** A login from a
Dhaka residential IP with no proxy returns:

```
HTTP/1.1 403 Forbidden
server: istio-envoy
x-envoy-upstream-service-time: 73
{"message":"Access forbidden","status_code":403}
```

That is an application answer from behind their gateway (Envoy upstream
timing, a JSON body), not a geo-block — a geo-block returns a challenge
page or drops the connection, and never evaluates credentials.

**So: do not architect this around an India-hosted worker.** The adapter
runs wherever the rest of the API runs. An egress droplet exists, and it
is for a human driving the panel in a browser — not for our traffic.

## RESOLVED 2026-09-09 — provisioned, verified, and a real parcel booked

An API user was created in the panel as `api@skydrop.online` (reachable
since Cloudflare Email Routing went in the same day —
`docs/email-dns.md`), with `68.183.190.55` in **Allowed IPs for PII
Access**. Everything below was then verified against the LIVE API.

```
POST /v1/external/auth/login                 → 200, token, company_id 9842446
GET  /v1/external/courier/serviceability/    → 200, Blue Dart ₹92.40, Ekart ₹69.36
```

**And the full booking contract, through our own adapter:**

```
awbNumber:         90658129413   (Blue Dart Air)
courierShipmentId: 1570668107
courierOrderId:    1574450075
cancel:            "Shipment(s) have been cancelled"
```

The live-write switches were on only for the length of that run, and
production went inert again immediately after it.

**That is no longer the state (corrected 2026-09-19).** Production now
carries `Courier.isActive` true, the real base URL and live writes on;
ordinary traffic does not DEFAULT here (`ops.default_courier_code` is
`delhivery` and no seller overrides it), but a parcel Delhivery refuses
fails over and is booked on Shiprocket for real.

### What the live run found

**The failure classifier defaulted everything unrecognised to
TRANSIENT** — the same shape Delhivery's had before CUR-13 was written,
never applied here. Shiprocket answered `422 {"message":"Phone number is
in invalid format"}` and we called it retryable, so BullMQ would have
retried a call that fails identically every time: never failing over,
never reaching manual placement, nobody told. It classifies on the
STATUS now (4xx = they formed an opinion about this parcel; 408/429 and
5xx = later), with word-matching kept only for errors carrying no status.

**A correction worth recording:** that first 422 was TEST DATA, not an
adapter bug. `9999999999` is a dummy Indian validators reject; the
adapter's `+91` stripping was always right, and a plausible number
booked first time. The two look identical from outside and only one of
them was ours.

**A pickup-location LIST endpoint exists** —
`GET /v1/external/settings/company/pickup` returns every registered
location (ours: `warehouse`, PIN 700128). CLAUDE.md said there was none;
that was true of Delhivery and got generalised.

**The NDR listing path was wrong.** `listNdr` called
`/v1/external/ndr`, which 404s; the real one is `/v1/external/ndr/all`.
`/v1/external/ndr/{awb}` is a PATTERN, which is why
`/v1/external/ndr/list` answers "Invalid AWB". No unit test could have
caught it: in stub mode the adapter never calls out, so the mock and the
code agreed with each other and with nothing else.

### Running a live test again — the shape matters

A script that boots **AppModule hangs**: that graph drags in Redis,
seventeen BullMQ producers and the portal browser pool, and something in
it blocks when the process is not the real API. The first attempt sat
there until killed — it created nothing, verified by searching the
account afterwards.

Boot a NARROW context. `CourierShiprocketModule` imports only
`RedisModule` + `CourierSharedModule` and registers no controllers, so a
root of `[ConfigModule, PrismaModule, AuthCommonModule,
CourierShiprocketModule]` resolves the adapter and nothing else.
`@Global()` on the first two means "available once imported at the
root", NOT "available without importing" — miss them and `RedisService`
cannot find `EnvService`.

**Dry-run in stub mode first.** That is what caught a request built to
the wrong shape (`ShiprocketAwbRequest` NESTS the recipient) before any
live write happened.

### PII is IP-gated, and it fails SOFT

`customer_phone` comes back as the literal string `"Not Authorized"`
from an IP that is not allowlisted — not an error, not null, a value
shaped exactly like data. Verified from Dhaka. Production is
allowlisted, so this is correct there and would silently degrade
anywhere else: **anything reading Shiprocket's customer fields must
treat that string as ABSENT.**

---

## Historical: what was blocking, as it stood on 2026-09-08

Panel credentials do not authenticate against the external API. The
timings say why:

| Email | Response | Upstream |
|---|---|---|
| an address that does not exist | `Invalid email and password combination` | 2ms |
| the real panel address | `Access forbidden` | 73ms |

Two different messages and a 35× difference in time: the account was
found and the password was almost certainly accepted, then refused by a
separate authorisation check. That is "no API user", not "wrong
password".

**To unblock** — in the panel, through an Indian IP: Settings → API →
create an API user. The email must not already be registered with
Shiprocket, and it should be on a domain we own (`api@skydrop.online`,
not a personal Gmail) so rotating the integration's password cannot
lock a human out of the panel or the reverse. If the API menu is not
there at all, access is gated behind KYC or plan tier and it is a
support call rather than a setting.

Then the only test that means anything:

```bash
curl -i -X POST https://apiv2.shiprocket.in/v1/external/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"api@skydrop.online","password":"'"$SHIPROCKET_API_PASSWORD"'"}'
```

`{"token": "..."}` is the answer. **Auth being reachable does not mean
every endpoint is** — before assuming the surface works from Dhaka, make
one authenticated call (serviceability is the cheapest) and read the
result rather than the docs.

## The account belongs to somebody else

The panel account is a SELLER account registered to a Gmail address on
the Indian side and displaying another person's name. Every
account-level change — creating the API user, KYC, bank details — needs
them or their credentials. This is not a proxy problem and cannot be
worked around by one: the login OTP goes to an Indian mobile, KYC wants
Aadhaar/PAN/GSTIN, and COD settlement requires a verified Indian bank
account because the RBI requires it.

Worth stating plainly because it changes the shape of the work: this
integration has a dependency on a third party's cooperation, not just on
engineering time.

## Where the code stands

**The settings list below is the 2026-09-08 reading and is STALE — it
says stub mode and live writes off, and production is neither.** It is
kept as the record of what the account looked like the day after the
proving run; read the live values from the database or from
`/shiprocket`, which was built for exactly this reason.

- `courier.shiprocket_api_base_url` = `''` ⇒ **stub mode** *(as of
  2026-09-08; the real base URL is set on production today)*, which was
  what CUR-15 required while Delhivery alone was live: a stub may never
  answer for a live courier, and the failover guard enforces it.
- `courier.shiprocket_live_writes_enabled` = **false** *(TRUE today)*.
- `courier.default_account_shiprocket` = `''` — no account linked.
- `courier.shiprocket_auto_pickup_enabled` = true, which was harmless
  while `assertWritable` refused first. With live writes ON it now
  means what it says.
- **New 2026-09-19:** `courier.shiprocket_pickup_location` (the sibling
  of Delhivery's — read for EVERY courier until then) and
  `courier.shiprocket_return_address` (JSON; their return create spells
  out both ends, so a collection cannot be booked without it). Both
  seeded EMPTY and refused by name rather than guessed.
  - **Two calls, two answers, and they are not the same question.**
    BOOKING a parcel (`orders/create/adhoc`) carries `pickup_location`,
    so with neither the account's own name nor this setting the booking
    is refused as TRANSIENT (`PICKUP_LOCATION_NOT_CONFIGURED`) — a setup
    gap, deliberately not an opinion about the parcel, so it neither
    fails over nor lands in manual placement. Asking for the VAN
    (`courier/generate/pickup`) takes shipment ids and nothing else, so
    it needs no name at all, and demanding one there refused collections
    that would have worked. `CourierOpsDispatchService.pickupNeedsLocationName`
    is the ONE place that knows the second half; do not "fix" the two to
    agree.

`ShiprocketHttpService` already caches a per-account bearer for **nine
days against their ten**, keyed on `courierAccountId` (never one shared
token — accounts are per-seller by CACC-1), and clears the cache and
retries ONCE on a 401 because their token can be invalidated
server-side by a password change. That matches the published 240-hour
lifetime; nothing needs changing there when credentials arrive.

## Credentials

Nothing goes in this file or the repo. `SHIPROCKET_API_EMAIL` /
`SHIPROCKET_API_PASSWORD` live in the environment, and the per-account
secret lives encrypted in `courier_credentials` and is only ever read
through `CourierCredentialService` (CUR-1: decrypt writes an audit row
first, plaintext is never logged or serialised).

**Outstanding, and it is not an engineering task:** the panel password
was exposed in plaintext during setup and must be rotated. That account
handles COD remittance.

## The India egress droplet (for a human, not for us)

DigitalOcean, Bangalore (BLR1), `Skydrop-India-Socket`, Ubuntu 24.04,
SSH-key only. No proxy software — OpenSSH is the SOCKS5 server:

```bash
ssh -D 0.0.0.0:1080 -N -C root@<droplet-ip>     # hangs with no output; that is -N working
```

Then a Chrome with its OWN `--user-data-dir` and
`--proxy-server="socks5://127.0.0.1:1080"`, so normal browsing stays on
the local connection. **Check `ifconfig.me` shows the droplet before
touching the panel** — a login attempt that leaks the real IP is the
thing this whole arrangement exists to avoid.

Housekeeping it shipped without: run the pending security updates and
reboot; `ufw allow OpenSSH && ufw enable` (an egress box should expose
nothing else); and check `date`, because the clock was months stale on
first boot and skew breaks TLS in ways that look like anything but a
clock.

## If panel automation is ever added

`courier-portal` already drives Delhivery's panel with Playwright, so
the shape exists and the temptation will be to reuse it here.

- Run the browser **on the droplet**, not tunnelled from Dhaka. A
  headless Chromium behind a tunnel carries an automation fingerprint
  AND latency that does not match its claimed location; in-region
  execution is the less-challenged of the two.
- 512MB is not enough for Chromium — resize first.
- Prefer the API for anything the API supports. Panel automation is for
  write paths the API does not expose, and it is the fallback, not the
  plan.

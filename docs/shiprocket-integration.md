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

## THE PANEL BLOCK IS THE ADDRESS **AND** THE BROWSER — both, ANDed (measured 2026-09-29)

> **THIS SUPERSEDES BOTH BOXES BELOW, AND EXPLAINS WHY THEY CONTRADICT
> EACH OTHER.** One investigation concluded "it is the IP"; the next
> concluded "it is the browser, not the address". Each was half right,
> and each was confounded by changing one variable while the other
> stayed broken.
>
> `apiv2.shiprocket.co/v1/auth/login/user` — the SECOND call of their
> panel's two-step sign-in — sits behind an **AWS WAF that refuses on
> EITHER of two signals**. Measured as a bare CORS preflight needing no
> credentials, five times per cell:
>
> | Egress | `Chrome/...` UA | `HeadlessChrome/...` UA |
> |---|---|---|
> | NordVPN Mumbai `187.13.246.12` | **200** (`access-control-allow-origin` present) | 403 |
> | DigitalOcean app droplet `68.183.190.55` | 403 | 403 |
> | DigitalOcean egress droplet `143.110.188.167` | 403 | 403 |
>
> A refusal is a **CloudFront** error page (`Request blocked.`) with no
> `access-control-allow-origin`; an allowed request reaches
> **istio-envoy**, their application, which answers
> `{"message":"Token not provided","status_code":400}` to a preflight-free
> POST. So the browser reports the POST as `net::ERR_FAILED` and their
> Angular app as **`status: 0`** — exactly the toast the owner saw
> through the Bangalore address, and exactly what makes this look like a
> session that will not hold rather than a block.
>
> **This is ONE path.** `/v1/auth/login` (step one),
> `/v1/get/version`, `/v1/settings/company/pickup` and
> `app.shiprocket.in/newlogin` itself all reach their application from
> every egress. Only `/v1/auth/login/user` is fenced — which is why the
> sign-in is accepted and the panel then will not open.
>
> **Do not measure this with a bare `OPTIONS`.** Without `Origin` and
> `Access-Control-Request-*` it is not a preflight and answers **403 from
> everywhere including the working exit** — that measurement is what
> produced "one endpoint refusing everybody is not an IP problem" on
> 2026-09-28, and it was an artefact. Likewise, `curl` with its default
> User-Agent is 403 from the working exit too. A useful probe sends a
> real preflight AND a browser UA.
>
> **Both halves are now fixed.**
> - Address: `courier.shiprocket_portal_proxy` = `http://127.0.0.1:1082`
>   (the NordVPN container), with
>   `courier.shiprocket_portal_egress_check_url` =
>   `http://127.0.0.1:8001/v1/publicip/ip` and
>   `courier.shiprocket_portal_egress_country` = `India`.
>   `docs/infrastructure.md` §7b.
> - Browser: `desktopChromeUserAgent` /`desktopChromeClientHints` in
>   `shiprocket-portal-session.service.ts` — the only token that moves
>   the answer is `HeadlessChrome` → `Chrome`; platform and version are
>   not read, so it claims the Linux it really is. **Delhivery's portal is
>   deliberately unchanged** — it signs in today, and altering the browser
>   presented to a working site to fix a different one leaves no way to
>   tell what helped.
> - And the sign-in now ASKS FIRST: `shiprocketEdgeRefusal` runs one
>   credential-free preflight before the password is even decrypted, so a
>   blocked address is named as a blocked address instead of costing a
>   login attempt and being read as an expired session.
>
> **The VPN server is re-picked on every restart** and a future exit
> could be on the same list. That is what the pre-login check exists to
> say out loud; the remedy is `sudo shiprocket-vpn rotate-key` and a
> re-run.
>
> **Two sign-ins were spent on 2026-09-28 and one on 2026-09-29.** Every
> measurement above needs none — the preflight is credential-free, and a
> made-up address is enough to see whether a request ARRIVES. Test there.

## The 2026-09-28 reading — SUPERSEDED, kept because its artefacts are instructive



> **CORRECTION to everything below this box.** The section that follows
> concluded "Shiprocket accepts the sign-in and then will not honour the
> session", which still holds, and the owner then found that their own
> Chrome could not log in through the Bangalore address while it could
> through NordVPN — which pointed at IP reputation. **A NordVPN route
> was built, and it changes nothing.** `shiprocket-vpn.service` on the
> app server (gluetun → NordVPN India, exit `187.13.247.153`, Mumbai,
> verified by NordVPN's own insights endpoint) was pointed at, and:
>
> | Measured through | `app.shiprocket.in/newlogin` | Login page renders | Sign-in |
> |---|---|---|---|
> | DigitalOcean direct (Dhaka/Bangalore) | 200 | yes | accepted, then bounced to `/newlogin` |
> | Bangalore SSH tunnel | 200 | yes, byte-identical | same |
> | NordVPN Mumbai exit | 200 | yes, byte-identical | same |
>
> "Byte-identical" is literal: a headless Chromium loading the login page
> through the tunnel and through the VPN produced the SAME control counts
> and the SAME list of failed sub-resources (a 403 on their WordPress
> `sprite.svg`, an APM beacon, and Google's ad pixels — all noise).
>
> **The call that actually breaks the sign-in is
> `apiv2.shiprocket.co/v1/auth/login/user`, and its CORS preflight
> answers 403 from ALL THREE vantage points.** The panel's
> `/v1/auth/login` preflight answers 200 from all three — so the 498 this
> file recorded earlier that day is no longer reproducible and was
> transient or has since changed. One endpoint refusing everyone is not
> an IP problem.
>
> **So the remaining difference between us and the owner's working Chrome
> is the BROWSER, not the address** — which points at the anti-bot bundle
> their login page loads, or at a panel rewrite our automation is driving
> the old flow of (their login response carries `web_app_version: 1` and
> `newpassbook: 0`). That is the thread to pull next; another egress is
> not.
>
> **The VPN is installed, documented and NOT in use.**
> `courier.shiprocket_portal_proxy` is back on the Bangalore tunnel and
> the egress-check settings are empty. `docs/infrastructure.md` §7b has
> what it is, how to switch to it, how to tell whether it is the cause of
> a failure, and how to remove it.
>
> **Two attempts were spent on this, both failing identically**, and the
> account is the one that handles COD remittance — do not keep trying
> sign-ins to test a theory about the network. The login page loads
> without credentials and renders identically; test there.

## The earliest reading, same day — SUPERSEDED (its "not our credentials, not the account" half still holds)


`ShiprocketWalletSyncService` (02:20 UTC) and `ShiprocketInvoiceCheckService`
(03:00 UTC) have failed every night since 21 and 22 September with one
sentence: *"the Shiprocket session has expired (landed on login)"*, zero
passbook rows. Costs stop moving and read as UNCOVERED in the P&L, not as
free. **Their API side is unaffected and still runs nightly** — the
Shiprocket cost sync read a wallet balance through
`apiv2.shiprocket.in` on the 28th, as it has every day throughout.

**What was measured, from Bangladesh with no proxy AND from the Bangalore
egress (143.110.188.167), with identical results:**

| Call | Answer |
|---|---|
| `POST apiv2.shiprocket.in/v1/external/auth/login` (OUR adapter) | 403 `Invalid email and password combination` for junk creds — healthy |
| `GET app.shiprocket.in/newlogin`, `/seller/wallet-transactions/passbook` | 200 |
| `POST apiv2.shiprocket.co/v1/auth/login` (the PANEL's own login) | **200, with a valid ten-day JWT, role `owner`, plan active, not suspended** |
| the browser afterwards | bounced to `/newlogin?routestate=seller%2Fhome`; every later panel call `401` |
| `OPTIONS apiv2.shiprocket.co/v1/auth/login` (the CORS preflight) | **498**, consistently, from both locations — and a run where the preflight was refused could not log in at all (`ERR_FAILED`, CORS) |

**So: not our credentials, not the tunnel, not geo, not the account.**
Shiprocket accepts the sign-in and then will not honour the session. That
needs their account manager, not a fix here.

**`apiv2.shiprocket.co` is a DIFFERENT HOST from `apiv2.shiprocket.in`,
and confusing them wastes a day.** `.co` is what their seller panel's
`apiPath` points at (read out of their own deployed web bundle on the
28th); `.in` is the public API our adapter uses. `.co` is UP — its
`/v1/auth/login` and `/v1/settings/...` answer normally. What is 503 on
it is `/v1/external/*`, a prefix **the panel never calls**, so that 503
is real, reproducible from everywhere, and *not the cause of anything*.
It is an easy thing to measure and mistake for a diagnosis.

**What our code did wrong, and is now fixed.**
`ShiprocketPortalSessionService.login()` ended on
`waitForURL(/\/seller\//)`, which resolves on the FIRST match and
returns. Their app routes to `/seller/...` and then bounces back to
`/newlogin`, so that match happened, `open()` reported success **from the
login page**, saved it as the session state, and every read afterwards
reported an expired session. It now settles and asks again, and a session
that did not hold raises its own HIGH issue
(`shiprocket-portal-rejected:<account>`) saying the sign-in was accepted
and refused — because the generic one sends somebody to re-check a
password and a tunnel that are both fine. Every panel job's failure now
also carries **what the browser could not load**
(`PortalNetworkWatch` → `handle.networkSummary()`), so
"401 apiv2.shiprocket.co/v1/get/version" is in the issue instead of
needing a terminal.

**Their panel's service hosts**, for whoever picks this up (from their
production bundle, 2026-09-28): `apiPath` `apiv2.shiprocket.co/v1/`,
`srAuth` `sr-auth.shiprocket.in/`, `srFinanceBaseUrl`
`sr-finance.shiprocket.in/api/v1/`, `BillingBaseUrl`
`srbs.shiprocket.in/api/1.0/`, `BillingGoBaseUrl` `srbs-go.shiprocket.in/v1/`,
`VasBillingBaseUrl` `sr-wallet.shiprocket.in/api/v1/`. The login response
also carries `web_app_version: 1` and `newpassbook: 0`, which are worth
asking them about: a panel rewrite would explain a session the old app
will not route.

---

## The two surfaces behave differently, and only one blocks us

> **AMENDED 2026-09-28.** The section below is the 2026-09-08 reading and
> its *conclusion* still holds — the API is not geo-restricted, the panel
> needs an Indian IP. What has since been said elsewhere and is NOT
> supported by any measurement is that a WAF blocks datacenter ranges:
> the Bangalore droplet and a Dhaka residential line got byte-identical
> answers from every host tested on the 28th. When the panel automation
> broke, the tunnel and the IP were the first two things checked and
> neither was the cause. Do not reach for the geo theory to explain a
> panel failure without measuring from both ends first.

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

> **The API user's email did NOT move in the 2026-10-04 `.global` cutover,
> and `api@skydrop.online` below is deliberate.** It is not a brand
> surface — it is the LOGIN of the Shiprocket API user, stored encrypted in
> `courier_credentials` (CUR-1), and it is where Shiprocket mails that
> user's password. Renaming it in this file would change nothing in their
> panel and would leave the one address a password reset arrives at
> undocumented. Two consequences for the cutover: **`api@skydrop.online`
> must keep receiving mail** (keep the Cloudflare Email Routing rule on the
> retired zone, or move the API user in their panel FIRST), and changing it
> is a deliberate panel operation plus a credential rotation — not a
> find-and-replace. The same account also handles COD remittance, so a
> failed sign-in is not a cheap thing to discover.

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

**What their public API exposes about MONEY, re-measured 2026-09-28.**
Their whole published surface is 93 requests, 31 of them GET, and only
three are money-shaped: `account/details/wallet-balance` (works; the
nightly cost sync uses it), `account/details/statement` and
`billing/discrepancy`. **The statement endpoint is NOT a ledger** — it
answers 200 with ONE row carrying the current balance and empty strings
everywhere else, exactly as their own published sample shows, whatever
`page` / `per_page` / `from` / `to` you send. So the wallet CANNOT come
off the browser, and COST-2's panel read stays. Their official MCP
server is live with 13 tools and none of them is a wallet either.
`POST /admin/shiprocket/api-probe` (`courier.accounts.manage`, GET-only,
audited) re-asks the whole list whenever somebody needs to check again
rather than trust this paragraph.

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

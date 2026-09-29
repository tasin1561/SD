# Seller-app tutorial videos

Narrated screen recordings of `apps/seller`, at 1920×1080. The whole planned
library — every screen in the seller and admin apps, in the order a person
meets them — is **`CURRICULUM.md`**; this file is the machinery.

| Video                               | What it covers                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `find-your-way-around.mp4`          | The console itself — the five collapsible sidebar groups, the order search that follows you everywhere, quick actions, the notification bell, and the standing facts along the bottom. No clicks that change anything.                                                                           |
| `set-up-your-profile.mp4`           | Company info, the logo your customers see on the tracking page, and bank details — where the lesson is that changing an account already on file goes to Skydrop for approval.                                                                                                                    |
| `place-an-order.mp4`                | A seller entering an order by hand — recipient, landmark, PIN, reference and call-centre note, picking products from the catalogue, quantity, cash-on-delivery amount, and submitting it into the call queue.                                                                                    |
| `add-a-product-with-variations.mp4` | Adding a product that comes in more than one version — the shared weight and declared value, a Colour option, a Size option (which Skydrop asks per colour), the four variants it multiplies out, editing a SKU while it is still editable, and saving.                                          |
| `keep-a-product-up-to-date.mp4`      | What can be changed about a product and what cannot — the defaults a variant inherits, adding a size to a product that already exists, the SKU greyed out with its reason, and the archive that cascades to variants while the restore does not.                                                             |
| `add-product-photos.mp4`            | Pictures for a SKU — the drop zone, one file and then two at once, what the three status badges are saying, which picture stands for the rest (and why there is no way to change that), and removing one.                                                                        |
| `upload-bulk-orders.mp4`            | A day's orders from a spreadsheet — the template, the check before importing (what we matched, rows versus orders, and the row that will not import because it has no landmark), the import running, and the four orders it placed, one of them assembled from two rows that shared a reference. |

Everything here is a script. **The media is gitignored**; run one command and
it is rebuilt.

## Re-running

```bash
# once: docker, api, seller
pnpm db:up
pnpm --filter @skydrop/api build && (cd apps/api && node dist/main.js &)
pnpm --filter @skydrop/seller build && (cd apps/seller && npx next start -p 3003 &)

scripts/tutorials/make-tutorials.sh                 # all of them
scripts/tutorials/make-tutorials.sh place-an-order  # just one
```

**To check a flow without spending anything**, which is what you want after a UI
change:

```bash
node scripts/tutorials/record.mjs --check place-an-order
```

It drives the real app with no narration and no video, holding each scene for a
fixed beat, and fails on the first step that cannot find what it reaches for. A
moved selector is the expensive half of a re-take and this is how it is found in
forty seconds rather than after a full render. It is also the only way to work
on a flow whose narration does not exist yet.

**What it does NOT prove is that the frame showed what the narration says.** A
step that finds its target and then dwells on a broken image, an empty list or a
stale panel passes exactly as loudly as one that works — the photos video passed
twice while rendering two of its three pictures broken, because a broken `<img>`
is still a visible `<img>`. So:

```bash
TUT_CHECK_SHOTS=1 node scripts/tutorials/record.mjs --check add-product-photos
# → out/verify/add-product-photos-check/NN-<step>.png, one per scene
```

Off by default, because most check runs are about a moved selector and the
shots cost wall clock. **Use it on every NEW flow, before spending a credit.**

`apps/seller` must be **built and started**, not `next dev` — the dev overlay
would be in the picture. It also needs `API_ORIGIN` pointing at the API: its
own default is port 3000 while apps/api runs on 4000, so put

```
API_ORIGIN=http://127.0.0.1:4000
```

in `apps/seller/.env.local` (gitignored) or export it before `next start`.
Without it every call 500s and the recording fails at sign-in.

## The keys

There is **more than one ElevenLabs account**, because one month's
allowance is smaller than one section of the library. Put one key per
line in `~/.config/skydrop/elevenlabs-keys`; blank lines and `#` comments
are skipped, so the file can say which account is which.

```
# main
sk_...
# spare
sk_...
```

The old single-key `~/.config/skydrop/elevenlabs` and `$ELEVENLABS_API_KEY`
still work and are the fallback when the list is absent. **The list wins
when both exist**, and that precedence is load-bearing: `make-tutorials.sh`
used to export the single-key file into the environment unconditionally, so
an env-first order would have run a two-key machine on one key and reported
a quota failure that was never real.

**A key is never printed** — not the key, not a prefix, not its length. Keys
are named by POSITION ("key 1", "key 2"), which is enough to say which
account paid for a clip. `KeyRing.redact()` is the backstop on every message
that leaves the module, because "we never log it" is not a property anybody
can check by reading.

**Rotation** happens on exhaustion and nothing else, and it retries **the
clip that failed** rather than moving on — anything else leaves a hole in
the middle of a video at the moment the run looked like it had recovered.
The three classes (`lib/elevenlabs-keys.mjs`):

| Class       | What it is                                         | What happens                    |
| ----------- | -------------------------------------------------- | ------------------------------- |
| `EXHAUSTED` | `quota_exceeded`, `insufficient_credits`, HTTP 402 | rotate, retry the same clip     |
| `TRANSIENT` | 429 rate limit, 5xx, a thrown `fetch`              | retry the same key, backing off |
| `FATAL`     | **everything else**                                | stop, and touch no other key    |

That last row is the important one. An unrecognised failure looks exactly
like an exhausted one from the outside, and treating the two alike burns
every key in the ring on one bad request. **A 401 is classified by its body,
not its status code**: it is what an out-of-credit account returns AND what a
key with the wrong scopes returns, and only `detail.status` tells them apart.
The live API answers `missing_permissions` with a **401** where their own
error reference says 403 `insufficient_permissions` — the live shape is what
is matched, and pinned.

When every key is spent the run **stops cleanly**, saying how many clips were
made and how many are left. It is resumable by re-running the same command:
the per-clip manifest means nothing already paid for is bought again.

### Two free checks

```bash
node scripts/tutorials/generate-voice.mjs --quota        # what each key has left
node scripts/tutorials/generate-voice.mjs --voice-check  # same narrator on every account?
```

`--quota` reads `/v1/user/subscription`; a generation run does the same thing
**before it spends anything**, and refuses up front when every balance is
known and the total is short. A balance it cannot read is reported as
unknown and the run goes ahead — a key scoped to text-to-speech alone cannot
call that endpoint, and blocking all production on a missing scope would be
the tail wagging the dog.

`--voice-check` is the guard against the library changing narrator half way
through. `EXAVITQu4vr4xnSDxMaL` is a stock voice and should be the same
person everywhere, but an account can clone or customise over a voice id, and
nobody would notice until a viewer did. **With one key it cannot fail** —
one account cannot disagree with itself — and that is correct rather than
weak. From the second key on, a mismatch **stops the run**, and so does not
being able to check: "we could not tell" and "it is fine" are the same
picture from here, and only one of them is safe to act on.

### Proving rotation without spending anything

```bash
node --test "scripts/tutorials/test/*.test.mjs"
```

Rotation only happens when an account runs out, which is the one condition
you cannot arrange on purpose without spending the account — so the
behaviour that matters most is the behaviour least likely to be exercised
before it is needed. The tests inject a `fetch`, so exhaustion is a thing
the test decides. They pin both silent ways it goes wrong: rotating on a
failure that was **not** exhaustion (which spends the next account on a bad
request), and retrying a spent key forever (which never finishes and never
says why).

**Mind the quota.** Narration is billed per character, so
`make-tutorials.sh` with no arguments can run out part-way through. A
clip already generated is free to re-use — the cache is keyed on the
words — so the cost of a re-take is only the lines that changed.

## Changing the narration

`narration.mjs` is the only place the words live. Edit a line and re-run; the
voice generator regenerates just that clip (clips are cached on a hash of the
text plus the voice settings), the recorder re-times that scene to the new
clip, and the composer places it at the new offset. Nothing is duplicated into
a timeline or a shot list, so there is nothing else to keep in step.

Keep each line to **8–15 seconds**. `generate-voice.mjs` prints the measured
length of every clip and flags anything outside that window — a line that has
grown too long announces itself rather than quietly running past the action it
describes.

To change what the camera _does_, edit `flows.mjs`. Step ids must match
`narration.mjs` exactly; `record.mjs` refuses to open the browser otherwise,
because a step with no action would record a still frame and look fine until
somebody watched it.

## The pieces

| File                               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed-demo-data.mjs`               | The demo seller, its catalogue, its stock and the Bangladesh intake warehouse. Idempotent, and it removes what a previous take created — the tutorial product, the orders, the imports, the consignment, a pending bank change — so a re-take starts from the same world. Takes the video's slug, and tailors: the orientation video wants a dashboard with orders on it, every other video wants the order list cleared. Refuses a non-local `DATABASE_URL`. |
| `narration.mjs`                    | The words, one entry per scene.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `generate-voice.mjs`               | ElevenLabs → one mp3 per scene, plus each clip's **measured** duration from ffprobe. Cached per line, and the cache manifest is written **after every clip** — see "Why the manifest is written per clip". Checks the budget before spending and the voice before filming.                                                                                                                                                                                    |
| `lib/elevenlabs-keys.mjs`          | The key ring: where keys are read from, which failures rotate and which stop, and why a key is never printed. See [The keys](#the-keys).                                                                                                                                                                                                                                                                                                                      |
| `test/key-rotation.test.mjs`       | Rotation, exhaustion and redaction against an injected `fetch` — the behaviour that costs credits to reach for real. `node --test "scripts/tutorials/test/*.test.mjs"`.                                                                                                                                                                                                                                                                                       |
| `lib/stage.mjs`                    | The sync marker, the click ripple, the highlight, and human-rate typing.                                                                                                                                                                                                                                                                                                                                                                                      |
| `lib/spaces-shim.mjs`              | Lets the browser finish a `mock://` upload, and lets it SEE the result. Recording rig only, armed per flow — see "Why the upload needs a shim".                                                                                                                                                                                                                                                                                                               |
| `fixtures/rangpur-bulk-orders.csv` | The file the bulk-import video uploads. Committed, because the preview's figures are narrated word for word.                                                                                                                                                                                                                                                                                                                                                  |
| `flows.mjs`                        | What the camera does, one function per scene.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `record.mjs`                       | Playwright drives the real app; each scene is held open for at least its clip plus a tail.                                                                                                                                                                                                                                                                                                                                                                    |
| `lib/markers.mjs`                  | Reads the markers back out of the recording.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `compose.mjs`                      | Retimes each segment to its narration, places each clip, renders H.264 + AAC.                                                                                                                                                                                                                                                                                                                                                                                 |
| `verify.mjs`                       | Frame per scene + `silencedetect`, so both halves can be checked.                                                                                                                                                                                                                                                                                                                                                                                             |
| `make-tutorials.sh`                | All of the above, in order, with the prerequisites checked.                                                                                                                                                                                                                                                                                                                                                                                                   |

## Why the marker

Playwright's video clock does not track wall time — the file it writes can be
materially shorter than the session that produced it, and not uniformly. So the
offsets the recorder measured are the wrong offsets to place audio at, and the
error accumulates scene by scene.

Each scene therefore stamps a 6×6 px square in the very top-left corner with a
colour of its own. That square is the one thing true in both clocks: it was set
at the instant the scene began, and the frame carrying it is where that scene
begins _in the file_. `compose.mjs` reads those pixels back
(`fps=25, crop=4:4:1:1, rawvideo rgb24`), retimes each segment so its picture
lasts exactly as long as its narration, and only then places the audio — after
which the two clocks agree by construction.

The square lives inside an 8 px strip that the final render crops away, so it
never reaches a viewer. The browser records at 1920×**1088** for that reason;
the output is 1920×1080.

The measured drift is printed on every compose. On the machine this was built
on it came out at ≈1.000×; the mechanism is what makes that a _measurement_
rather than an assumption.

## Why the upload needs a shim

Local object storage is a stub: `DEV_MOCK_SPACES=true` makes
`SpacesService.presignPutUrl` return a `mock://<bucket>/<key>` string and
keeps objects on disk under `/tmp/skydrop-spaces-mock`. The seller's CSV
panel then does a real `fetch(uploadUrl, { method: 'PUT', body: file })`,
which is right against DigitalOcean and cannot work here for two separate
reasons: Chromium cannot fetch an unknown scheme at all, and `next start`
serves the real CSP, whose `connect-src` would not admit an arbitrary host
even if the URL were a real one.

`lib/spaces-shim.mjs` wraps `window.fetch` in an init script so a
`mock://` PUT never becomes a request: the bytes go to Node through an
exposed binding, Node writes them where `SpacesService` would have, and
the page gets a synthetic `200`. Everything else reaches the page's own
`fetch` untouched. A JS-level override rather than `page.route` because
there is no request to intercept and a CSP refusal happens before routing.

**The GET side needed the same treatment, for a different reason.** A
presigned READ is a `mock://` string too, and the app puts it straight
into an `<img src>`. That is not a `fetch`, so the wrapper above cannot
help: the browser tries to load an unknown scheme and the frame renders
broken — which, in a tutorial about uploading a logo, reads as a failed
upload. Each one is swapped for a `data:` URL of the bytes Node holds,
via a `MutationObserver` (the upload REPLACES the element, so a one-shot
sweep would catch the placeholder and miss the result). `img-src` already
admits `data:` in the real CSP, so nothing is widened for the rig.

**Nothing in the app changes for this.** A video is not a reason to widen
a CSP or to teach a service a second upload path. It is armed per flow
(`needsSpacesShim: true` in `flows.mjs`), so the flows that upload
nothing record against a stock `fetch`.

## Why the manifest is written per clip

`clips.json` is what makes a clip re-usable: it records the duration
ffprobe measured and a fingerprint of the words it was made from. A clip
with no entry is regenerated on the next run, and regenerating costs
credits.

It used to be written once, after the whole loop. So a run that failed on
its **last** line threw away every clip it had just paid for — which is
exactly what happened here, on a quota that then had nothing left to buy
them again with. It is now written after each clip.

`--adopt` is the way back from a manifest lost to the old behaviour: it
takes mp3s that are on disk with no entry, measures them, and records
them. It is opt-in and prints `ADOPTED — unverified against the text` on
every line, because the one thing it cannot check is whether the words in
the file are still the words in `narration.mjs`.

## Gotchas worth knowing before a re-take

- **Seller login is throttled at 5 attempts per 15 minutes** per email + IP, and
  a video costs THREE sign-ins — two `--check` passes and the take — so the
  fourth video in any quarter of an hour is refused. `flows.mjs` reports the
  page's own verdict rather than a bare timeout, so it is obvious.
  **Do not wait it out by retrying.** A refused attempt writes its own
  `blocked` key with a fresh TTL, so each retry pushes the window further out
  (observed at 839 s remaining after a few). Run
  `node scripts/tutorials/lib/clear-login-throttle.mjs`, which
  `make-tutorials.sh` now does before every video: the counter lives in Redis,
  clearing it changes no product code, and the helper refuses a non-local
  `REDIS_URL` — on a real deployment that counter is the brute-force protection
  on seller accounts.
- **Seed before each video, not once.** `make-tutorials.sh` does. The product
  video creates `Rajshahi Silk Kurti` on camera; if the order video runs after
  it, that product is in its catalogue as four out-of-stock rows.
- **A SKU is permanent once saved.** That is why the seed deletes the tutorial
  product rather than letting the take collide on it.
- **The bulk-import video leaves four orders, an import record, a staged row
  and two objects in mock storage.** The seed removes all of them, so the
  fixture's `External Ref`s are re-usable on every take. Without that, the
  "Recent imports" table opens on the last take's run and the second take
  films a different page.
- The recorder writes `out/verify/<slug>-failure.png` when a flow breaks. It is
  usually enough on its own — the failures during this build were all visible
  in it.

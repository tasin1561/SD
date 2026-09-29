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

`apps/seller` must be **built and started**, not `next dev` — the dev overlay
would be in the picture. It also needs `API_ORIGIN` pointing at the API: its
own default is port 3000 while apps/api runs on 4000, so put

```
API_ORIGIN=http://127.0.0.1:4000
```

in `apps/seller/.env.local` (gitignored) or export it before `next start`.
Without it every call 500s and the recording fails at sign-in.

The ElevenLabs key is read from `~/.config/skydrop/elevenlabs` or
`$ELEVENLABS_API_KEY`. It is never written into a file here.

**Mind the quota.** Narration is billed per character and the account's
allowance is about eight tutorials' worth a month, so
`make-tutorials.sh` with no arguments can run out part-way through. A
clip already generated is free to re-use — the cache is keyed on the
words — so the cost of a re-take is only the lines that changed.
`announce-a-consignment` is in the default list with its narration
written and its flow proven (`--check`) but **no audio yet**; it is the
first thing to generate when the quota next resets.

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
| `generate-voice.mjs`               | ElevenLabs → one mp3 per scene, plus each clip's **measured** duration from ffprobe. Cached per line, and the cache manifest is written **after every clip** — see "Why the manifest is written per clip".                                                                                                                                                                                                                                                    |
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

- **Seller login is throttled at 5 attempts per 15 minutes** per email + IP. A
  re-take straight after a run of probes fails at sign-in; `flows.mjs` reports
  the page's own verdict rather than a bare timeout, so it is obvious. Wait the
  window out.
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

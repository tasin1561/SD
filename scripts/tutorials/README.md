# Seller-app tutorial videos

Two narrated screen recordings of `apps/seller`, at 1920×1080:

| Video | What it covers |
|---|---|
| `place-an-order.mp4` | A seller entering an order by hand — recipient, landmark, PIN, reference and call-centre note, picking products from the catalogue, quantity, cash-on-delivery amount, and submitting it into the call queue. |
| `add-a-product-with-variations.mp4` | Adding a product that comes in more than one version — the shared weight and declared value, a Colour option, a Size option (which Skydrop asks per colour), the four variants it multiplies out, editing a SKU while it is still editable, and saving. |

Everything here is a script. **The media is gitignored**; run one command and
it is rebuilt.

## Re-running

```bash
# once: docker, api, seller
pnpm db:up
pnpm --filter @skydrop/api build && (cd apps/api && node dist/main.js &)
pnpm --filter @skydrop/seller build && (cd apps/seller && npx next start -p 3003 &)

scripts/tutorials/make-tutorials.sh                 # both videos
scripts/tutorials/make-tutorials.sh place-an-order  # just one
```

`apps/seller` must be **built and started**, not `next dev` — the dev overlay
would be in the picture.

The ElevenLabs key is read from `~/.config/skydrop/elevenlabs` or
`$ELEVENLABS_API_KEY`. It is never written into a file here.

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

To change what the camera *does*, edit `flows.mjs`. Step ids must match
`narration.mjs` exactly; `record.mjs` refuses to open the browser otherwise,
because a step with no action would record a still frame and look fine until
somebody watched it.

## The pieces

| File | What it does |
|---|---|
| `seed-demo-data.mjs` | The demo seller, its catalogue and its stock. Idempotent, and it deletes the product the second video creates so a re-take can create it again. Refuses a non-local `DATABASE_URL`. |
| `narration.mjs` | The words, one entry per scene. |
| `generate-voice.mjs` | ElevenLabs → one mp3 per scene, plus each clip's **measured** duration from ffprobe. Cached per line. |
| `lib/stage.mjs` | The sync marker, the click ripple, the highlight, and human-rate typing. |
| `flows.mjs` | What the camera does, one function per scene. |
| `record.mjs` | Playwright drives the real app; each scene is held open for at least its clip plus a tail. |
| `lib/markers.mjs` | Reads the markers back out of the recording. |
| `compose.mjs` | Retimes each segment to its narration, places each clip, renders H.264 + AAC. |
| `verify.mjs` | Frame per scene + `silencedetect`, so both halves can be checked. |
| `make-tutorials.sh` | All of the above, in order, with the prerequisites checked. |

## Why the marker

Playwright's video clock does not track wall time — the file it writes can be
materially shorter than the session that produced it, and not uniformly. So the
offsets the recorder measured are the wrong offsets to place audio at, and the
error accumulates scene by scene.

Each scene therefore stamps a 6×6 px square in the very top-left corner with a
colour of its own. That square is the one thing true in both clocks: it was set
at the instant the scene began, and the frame carrying it is where that scene
begins *in the file*. `compose.mjs` reads those pixels back
(`fps=25, crop=4:4:1:1, rawvideo rgb24`), retimes each segment so its picture
lasts exactly as long as its narration, and only then places the audio — after
which the two clocks agree by construction.

The square lives inside an 8 px strip that the final render crops away, so it
never reaches a viewer. The browser records at 1920×**1088** for that reason;
the output is 1920×1080.

The measured drift is printed on every compose. On the machine this was built
on it came out at ≈1.000×; the mechanism is what makes that a *measurement*
rather than an assumption.

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
- The recorder writes `out/verify/<slug>-failure.png` when a flow breaks. It is
  usually enough on its own — the failures during this build were all visible
  in it.

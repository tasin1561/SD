# UI audit — every screen, at every width

A responsive and alignment sweep over the app consoles. It walks every
page route an app declares, at six widths, and reports what is broken
rather than what might be: content past the viewport, text clipped with
no way to read it, a control under the tap-target floor, two controls on
top of each other, an input iOS will zoom into.

```sh
eval "$(bash scripts/tutorials/stack.sh env a)"       # the filming stack
node scripts/ui-audit/audit.mjs seller                # one app, all widths
node scripts/ui-audit/audit.mjs admin --widths=320,360
node scripts/ui-audit/audit.mjs seller --route=/settings/webhooks --shots
node scripts/ui-audit/_selftest.mjs                   # prove the rules still look
```

Apps: `admin` · `seller` · `reseller` · `associate` · `track`. After a
CSS change in `packages/ui`, rebuild that package AND the app — the apps
consume compiled output, so a source-only change measures the old build.
Then restart the app and check `stack.sh status a` says UP, not STALE: a
`next start` holds the build it loaded at boot, so a rebuild under a
running process leaves it serving HTML for chunks that no longer exist,
the page never hydrates, and the sweep fails at sign-in.

**Never rebuild while a sweep is running against that app.** The run
measures whichever build each page happened to get, and the pages caught
mid-swap come back as NOT MEASURED — which is at least loud, but the rest
of the run is not worth reading.

## Dynamic routes are swept too

`/orders/[id]` is resolved to a real id by READING THE APP'S OWN LIST
PAGE — `/orders` is visited and the first link one level deeper gives the
id; a nested param (`/products/[id]/variants/[variantId]`) resolves left
to right, each step visiting the concrete parent the last one produced.
A static sibling (`/orders/new`) is excluded by name from the app's route
table, so it is never mistaken for a record.

Read off the page rather than out of the database on purpose: no extra
credentials, nothing to drift from the schema, and it can only ever open
a record this signed-in user is allowed to see. **A route whose list is
empty is NAMED as not swept**, never silently dropped.

It earned its place on the first run: the admin order page — which no
sweep had ever opened — was pushing the document 104px sideways at 320px
on a `nowrap` uuid.

## A clean run has to prove it RAN

The failure this harness is most likely to have is not a missed bug, it
is a sweep that measured sign-in screens and reported no findings. Two
guards exist for that and both are proven by `_selftest.mjs`:

* **A bounce to `/login`** is counted as `NOT MEASURED`, never as clean.
* **An `(authed)` route that renders no app shell** is counted the same
  way. Which routes are expected to have one comes from the `(authed)`
  route group in the filesystem, so it cannot drift from the app.

Either makes the summary say *treat this run as incomplete, not as
clean*. **A run with a non-zero `NOT MEASURED` count is not a result.**

The session itself is the fragile part. One context per POINTER KIND
(touch ≤768, fine >768) with `setViewportSize()` between widths — two
logins, one cookie handover. Six contexts meant five handovers, and each
is a chance to present a refresh token the previous context already
spent, which the API reads as replay and answers by burning the family
(FE-4). Sign-in is throttled 5 per 15 minutes per email+IP, so the sweep
clears the counter before it starts.

## The one bug this keeps finding

Every real "text past its box" finding has been one of two things, and
both are about a MINIMUM rather than a width:

* **A flex or grid ITEM defaults to `min-width: auto`** — its content's
  minimum — so it will not shrink however narrow the parent gets.
  `min-width: 0` on the CONTAINER is not the same thing and reads as
  though it were.
* **A single-column grid with no declared track** gets an implicit
  `auto` column whose minimum is its WIDEST item's min-content. So the
  container says "I may be narrow" and the track inside it refuses — and
  then EVERY child, sized to that same track, spills by the identical
  amount. On `/seller-wallets` one `nowrap` uuid floored the track at
  248px inside a 224px cell and three children reported as broken.
  `grid-template-columns: minmax(0, 1fr)` is the fix.

`81` selectors in this repo are `display: grid` + `min-width: 0` with no
declared track. Only the ones with a measured defect have been changed —
the rest are not currently broken, and 79 speculative edits would be a
large diff behind no evidence. **If a sweep reports a spill on a grid
child, check the parent's track before anything else.**

Third, less often: **`white-space: nowrap` on something that is not one
token.** `.sk-ident` means "an ID: monospace AND never broken", right for
a waybill read down a phone and wrong for an event list, a topic key, an
email or a uuid. `.sk-ident--wrap` is the opt-out.

## When a finding is wrong, fix the RULE

Every rule here has been wrong at least once, and each exclusion is
written down with the case that taught it:

* a designed `line-clamp` is not clipped text
* an element clipped by an ancestor cannot widen the document
* a sticky bar, a dropdown and an `opacity: 0` radio over its own label
  all overlap on purpose — compare layer OWNERS, by identity
* a row scrolled out of a `max-height` list has a rect where nobody can
  see it — compare VISIBLE boxes

Contrast is deliberately not measured; `audit.mjs` says why at length.

**After relaxing a rule, prove it still looks.** `_selftest.mjs` injects
the old broken CSS back over the live page, asserts the finding returns,
then removes it and asserts it goes. A rule that went quiet because it
stopped looking reads exactly like a rule that went quiet because the
bug was fixed.

A page that THREW counts as unmeasured as well: one transient
`ERR_NETWORK_CHANGED` on associate `/tickets/new` had read as a clean
run.

## The session is the fragile part

Each context SIGNS IN FOR ITSELF. Capturing one cookie jar and handing
it to a second context presents a refresh token the first already spent
— the client rotates silently (FE-4) — and the API answers by burning
the family, after which every page is a sign-in screen and the sweep
reports no findings. That went from six contexts and five handovers, to
two and one with a settle before capture (which narrowed it and did not
close it — admin still lost its session 25 routes in, 103 page-widths
unmeasured), to no handover at all. Two logins per app is well inside
the 5-per-15-minutes throttle the capture was invented to avoid, and the
sweep clears that counter before it starts anyway.

`out/` holds each app's `findings.json` and log; it is generated and
gitignored.

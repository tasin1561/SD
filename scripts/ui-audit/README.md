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

Apps: `admin` · `seller` · `reseller` · `associate` · `track`. Each needs
its stack-A app running (`bash scripts/tutorials/stack.sh restart a <app>`)
and, after a CSS change in `packages/ui`, a rebuild of that package first —
the apps consume compiled output, so a source-only change measures the
old build.

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

`out/` holds each app's `findings.json` and log; it is generated and
gitignored.

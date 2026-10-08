# The long videos, and why they live in their own files

`narration.mjs` is 5,500 lines and `flows.mjs` is 16,600. Four people
writing a video each into those two files is four people editing the same
two files, so the long videos are written one-per-module here and
REGISTERED by a single spread at the bottom of each shared file.

Nothing in `scripts/tutorials/*.mjs` needs to change to add another one
beyond that spread, and two authors never touch the same file.

## What a module exports

```js
export const narration = {
  slug: 'seller-everything',          // the file name, and the mp4 name
  title: 'Getting your products to India',
  subtitle: 'Skydrop for sellers',
  steps: [{ id: 'intro', say: 'English only — see below.' }, …],
};

export const flow = {
  app: 'seller',                       // seller | reseller | associate
  seed: ['…'],                         // what seed-demo-data must have made
  steps: [{ id: 'intro', run: async (s) => { … } }, …],
};
```

**Every `narration.steps[].id` must have a `flow.steps[].id` and the other
way round** — `record.mjs` throws on a stray either way, which is the
check that stops a video narrating a screen it never shows.

**The array of `{ id, run }` is deliberate and is NOT what the runner
takes.** `flows.mjs` keys steps by id (`steps: { async intro(ctx) {} }`)
because `record.mjs` looks one up by name. `long/index.mjs` converts the
array once, on the way in, because the array preserves ORDER — the thing
a reader of a twelve-minute script actually wants — and gives every step
somewhere to carry its own docblock. Write the array; the seam handles
the rest, and refuses a missing id, a missing `run` and a duplicate id
rather than letting any of the three surface as a finished video.

## Write ENGLISH only

`say` is English. Bangla and Hindi arrive later as `sayBn` / `sayHi` on
the same step, added by the translation pass, and the generator picks the
field and the voice by language. An author writing three languages at
once would have three half-checked scripts instead of one good one.

## The house rules for these scripts

- **The long video is the SPINE, not a tour.** The 87 short videos are
  the reference; this is the path through them. When a screen is worth a
  mention but not a minute, say "there is a short video on this" and move.
- **Nothing is explained twice.** The seller video explains the shell,
  the sidebar and the money once. The others assume it.
- **Say what the screen is FOR before saying what to click.** A viewer
  who knows why can follow a click they did not see coming; one who only
  saw the click cannot repeat it anywhere else.
- **No filler.** Not "as you can see", not "simply", not "just". If a
  sentence does not teach, cut it — the owner asked for these to be as
  short as they can be without losing anything.
- **Numbers over adjectives.** "Confirmed by phone before it ships"
  beats "great service".

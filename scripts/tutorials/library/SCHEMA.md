# The tutorial library data contract

Two files feed the interactive PDF. They are generated separately and
joined at render time, so the slow-moving one (what the product has) and
the fast-moving one (where the videos are hosted) never block each other.

## `library.json` — what exists

Generated from `CURRICULUM.md`, `scripts/tutorials/long/*.mjs`,
`scripts/tutorials/out/*.mp4` and the apps' own route trees. Everything
in it is derivable from the repo; nothing is typed by hand.

```jsonc
{
  "generatedAt": "2026-11-08T00:00:00Z",
  "consoles": [
    {
      "key": "admin",                       // admin | client | member | associate | track | marketing
      "name": "Admin",                      // the word a PERSON reads — "Client", not "seller"
      "host": "https://admin.skydrop.global",
      "who": "Skydrop staff — call centre, warehouse, finance",
      "pages": [
        {
          "path": "/warehouse/pack",        // route, leading slash
          "title": "Pack station",          // the page's own h1 where findable, else a humanised path
          "section": "Warehouse"            // the sidebar group it sits under, when known
        }
      ]
    }
  ],
  "tutorials": [
    {
      "slug": "admin-everything",
      "title": "Admin — everything",
      "console": "admin",                   // which console it is filmed in
      "kind": "long",                       // long | short | promo
      "section": "H — the desk",            // CURRICULUM.md section, for the index
      "order": 1,                           // order within the section
      "summary": "One sentence on what the viewer can do afterwards.",
      "steps": ["Dashboard", "Finding an order"],  // the scene/section headings, for the step-by-step index
      "durationSeconds": 5410,
      "languages": ["en", "bn"],            // which takes actually exist as .mp4
      "files": { "en": "admin-everything.mp4", "bn": "admin-everything-bn.mp4" },
      "teaches": ["/warehouse/pack"]        // console page paths this tutorial covers, when derivable
    }
  ]
}
```

## `drive-links.json` — where the videos live

Hand-maintained, or produced by an upload script. Keyed by the same
slug + language. A missing entry is NOT an error: the PDF renders the
row with "not uploaded yet" rather than a dead link, so the document is
useful before every video is hosted.

```jsonc
{
  "folder": "https://drive.google.com/drive/folders/…",   // optional: the whole library
  "videos": {
    "admin-everything": {
      "en": "https://drive.google.com/file/d/…/view",
      "bn": "https://drive.google.com/file/d/…/view"
    }
  }
}
```

## Why two files

The library is derived and regenerates in seconds; the links are earned
and change rarely. Keeping them apart means re-uploading one video does
not require regenerating everything, and a missing link never silently
becomes a broken one — the renderer can tell "absent" from "wrong".

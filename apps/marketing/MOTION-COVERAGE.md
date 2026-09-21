# Motion coverage — where every reference pattern lives

The 46 reference patterns (35 UI upgrades u01–u35 and 11 storytelling controls) and where
each is used on skydrop.online, or why it is not. Ideas only: our tokens, icons and copy;
transform/opacity only; no new libraries. Updated per phase; Phase 9 checks it for gaps.

Status: **used** (shipped) · **planned** (Phase named) · **n/a** (reason).

## UI upgrades

| #   | Pattern            | Status  | Where                                                                                                                                           |
| --- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| u01 | Footer             | used    | `site-footer.tsx` — brand block, coloured circular socials, marker links that slide, newsletter card hidden until an endpoint exists, legal bar |
| u02 | Phone input        | used    | `micro/phone-field` — hero Book tab; contact form (Phase 4)                                                                                     |
| u03 | Checkbox           | used    | `micro/touches` DrawCheckbox (+ hover halo) — feature checklists in the platform tour (Phase 5)                                                 |
| u04 | Filter bar         | planned | Phase 4 — "What you can / can't send" chips                                                                                                     |
| u05 | Select dropdown    | used    | `micro/text-field` SelectField — invite page; estimator                                                                                         |
| u06 | Chat input         | n/a     | no chat on the site (ChatWoot is a separate droplet, deferred)                                                                                  |
| u07 | Data table         | planned | Phase 4 — pricing / compare; Phase 5 — orders, registers, ledger mocks                                                                          |
| u08 | Switch             | used    | `micro/touches` DrawToggle with ON / OFF in the track — COD switch (Phase 4), STRICT mode etc. (Phase 5)                                        |
| u09 | Tabs               | used    | `micro/liquid-bead` pill variant — hero action card; service showcase (Phase 4)                                                                 |
| u10 | Radio cards        | used    | `micro/choice-cards` — hero quote + book direction; freight-billing choice, "Directly / Needs my approval" (Phase 5)                            |
| u11 | Success popup      | used    | `micro/success-card` — hero Book tab after a real 201                                                                                           |
| u12 | Quantity stepper   | used    | `micro/stepper` — hero quote weight; estimator dims; "Units set aside" (Phase 5)                                                                |
| u13 | Password strength  | n/a     | no password field on the marketing site                                                                                                         |
| u14 | Theme switch       | used    | `micro/theme-switch` — header and drawer                                                                                                        |
| u15 | Profile upload     | planned | Phase 5 — drag-and-drop product images in the catalogue vignette                                                                                |
| u16 | Pagination         | planned | Phase 4 — testimonials carousel pager                                                                                                           |
| u17 | Order tracking     | used    | `micro/tracking-card` — hero Track tab (Sample); track band (Phase 4); order lifecycle mock (Phase 5)                                           |
| u18 | Cascading dropdown | planned | Phase 4 — estimator country → division/state → city                                                                                             |
| u19 | Accordion          | planned | Phase 4 — FAQ                                                                                                                                   |
| u20 | Hamburger drawer   | used    | `site-header.tsx` drawer — icon-chip rows that stagger in, active row filled, theme switch at the bottom                                        |
| u21 | Stacked list       | used    | `micro/list-row` — drawer; mega-menus, coverage cities, credentials (Phase 4); team/stores mocks (Phase 5)                                      |
| u22 | Snackbar           | used    | `micro/toast` with `action` — "CN-… cancelled — 40 units returned to you" (Phase 5)                                                             |
| u23 | Sidebar            | planned | Phase 5 — frame of every platform mock                                                                                                          |
| u24 | Multi-select       | planned | Phase 4 — "what are you sending"; Phase 5 — store allow-list                                                                                    |
| u25 | Contact form       | planned | Phase 4 — icon-led floating fields, counter, reassurance line (mailto/WhatsApp fallback, hover feedback only)                                   |
| u26 | Chat UI            | n/a     | no chat on the site                                                                                                                             |
| u27 | Empty state        | used    | `micro/empty-state` — not serviceable (Phase 4), not-found routes (Phase 6)                                                                     |
| u28 | Button sweep       | used    | `micro/sweep` — header CTA, drawer CTA, hero submit (van button), every primary CTA from here on                                                |
| u29 | URL input          | n/a     | no URL field on the site                                                                                                                        |
| u30 | Sticky header      | used    | `site-header.tsx` — floating rounded bar, condenses on scroll, scroll-spy accent pill (`header-nav.tsx`)                                        |
| u31 | Dashboard header   | used    | `micro/icon-button` — header menu/close; Phase 5 — dashboard mock headers                                                                       |
| u32 | Toast              | used    | `micro/toast` — "Number copied"; credited/settled events (Phase 5)                                                                              |
| u33 | Text input         | used    | `micro/text-field` — hero waybill field, hero Book tab, invite page, every form from here on                                                    |
| u34 | Stepper (progress) | planned | Phase 4 — How it works; Phase 5 — consignment legs                                                                                              |
| u35 | Tooltip card       | used    | `micro/tooltip-card` TermTip — glossary (COD, RTO, volumetric weight, waybill, GST invoice, Instant Pay); wired into copy from Phase 4          |

## Storytelling controls

| #   | Pattern                         | Status   | Where                                                                                                                                                   |
| --- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Parachute progress              | used     | hero quote "Calculate"; estimator (Phase 4)                                                                                                             |
| 2   | Van drive-off                   | used     | invite form submit (hero Book tab and /request-invite)                                                                                                  |
| 3   | Glow field                      | gallery  | newsletter (hidden until an endpoint exists)                                                                                                            |
| 4   | Paper-plane send                | gallery  | newsletter (same)                                                                                                                                       |
| 5   | Rolling-label button            | used     | hero Track button (Track → Finding…)                                                                                                                    |
| 6   | Label-into-parcel               | planned  | Phase 4 — contact form button hover                                                                                                                     |
| 7   | Expanding track field           | used     | header                                                                                                                                                  |
| 8   | Liquid bead                     | used     | hero tabs (pill), bottom bar (icon); service showcase / FAQ tabs (Phase 4)                                                                              |
| 9   | Contact fan                     | used     | floating contact button; bottom bar Contact                                                                                                             |
| 10  | Segmented code → link-and-merge | planned  | Phase 4 — coverage PIN/postcode checker                                                                                                                 |
| 11  | Scene switcher                  | planned  | Phase 4 — service showcase                                                                                                                              |
| 12  | Feature vignette (beats)        | planned  | Phase 5 — platform tour                                                                                                                                 |
| 13  | Reactive mascot                 | optional | Phase 7                                                                                                                                                 |
| 14  | Door hover                      | optional | Phase 7                                                                                                                                                 |
| 15  | Supporting touches              | used     | theme morph (superseded by u14 on the chrome), chevron morph, copy tick, floating labels (superseded by u33), draw-on checkbox/toggle, validation icons |

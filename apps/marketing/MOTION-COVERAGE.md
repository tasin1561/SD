# Motion coverage — where every reference pattern lives

The 46 reference patterns (35 UI upgrades u01–u35 and 11 storytelling controls) and where
each is used on skydrop.online, or why it is not. Ideas only: our tokens, icons and copy;
transform/opacity only; no new libraries. Updated per phase; Phase 9 checks it for gaps.

Status: **used** (shipped) · **planned** (Phase named) · **n/a** (reason).

## UI upgrades

| #   | Pattern            | Status  | Where                                                                                                                                           |
| --- | ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| u01 | Footer             | used    | `site-footer.tsx` — brand block, coloured circular socials, marker links that slide, newsletter card hidden until an endpoint exists, legal bar |
| u02 | Phone input        | used    | `micro/phone-field` — hero Book tab; contact form (Phase 6)                                                                                     |
| u03 | Checkbox           | used    | `micro/touches` DrawCheckbox (+ hover halo) — feature checklists in the platform tour (Phase 5)                                                 |
| u04 | Filter bar         | used    | `micro/chip-select` (single) — "What you can send" verdict filter                                                                               |
| u05 | Select dropdown    | used    | `micro/text-field` SelectField — invite page                                                                                                    |
| u06 | Chat input         | n/a     | no chat on the site (ChatWoot is a separate droplet, deferred)                                                                                  |
| u07 | Data table         | used    | `micro/data-table` — Compare (swipe cards below md); Phase 5 — orders, registers, ledger mocks                                                  |
| u08 | Switch             | used    | `micro/touches` DrawToggle with ON / OFF — estimator COD switch; STRICT mode etc. (Phase 5)                                                     |
| u09 | Tabs               | used    | `micro/liquid-bead` pill — hero action card; who-we-serve tabs; coverage direction                                                              |
| u10 | Radio cards        | used    | `micro/choice-cards` — hero quote + book direction; estimator direction and parcel type; Phase 5 choices                                        |
| u11 | Success popup      | used    | `micro/success-card` — hero Book tab after a real 201                                                                                           |
| u12 | Quantity stepper   | used    | `micro/stepper` — hero quote weight; estimator weight and L × W × H; "Units set aside" (Phase 5)                                                |
| u13 | Password strength  | n/a     | no password field on the marketing site                                                                                                         |
| u14 | Theme switch       | used    | `micro/theme-switch` — header and drawer                                                                                                        |
| u15 | Profile upload     | planned | Phase 5 — drag-and-drop product images in the catalogue vignette                                                                                |
| u16 | Pagination         | used    | `micro/pagination` — testimonials carousel pager (bubble travels)                                                                               |
| u17 | Order tracking     | used    | `micro/tracking-card` — hero Track tab (Sample); track band (Sample); order lifecycle mock (Phase 5)                                            |
| u18 | Cascading dropdown | used    | `micro/combo-select` — estimator state/division → city cascade                                                                                  |
| u19 | Accordion          | planned | Phase 6 — FAQ                                                                                                                                   |
| u20 | Hamburger drawer   | used    | `site-header.tsx` drawer — icon-chip rows that stagger in, active row filled, theme switch at the bottom                                        |
| u21 | Stacked list       | used    | `micro/list-row` — drawer; header mega-menus (Services, Platform); coverage lanes; Why Skydrop rows; Phase 5 team/stores mocks                  |
| u22 | Snackbar           | used    | `micro/toast` with `action` — "CN-… cancelled — 40 units returned to you" (Phase 5)                                                             |
| u23 | Sidebar            | planned | Phase 5 — frame of every platform mock                                                                                                          |
| u24 | Multi-select       | used    | `micro/chip-select` (multiple) — estimator "what are you sending"; Phase 5 — store allow-list                                                   |
| u25 | Contact form       | planned | Phase 6 — icon-led floating fields, counter, reassurance line (mailto/WhatsApp fallback, hover feedback only)                                   |
| u26 | Chat UI            | n/a     | no chat on the site                                                                                                                             |
| u27 | Empty state        | used    | `micro/empty-state` — coverage "Somewhere else?" → WhatsApp; not-found routes (Phase 6)                                                         |
| u28 | Button sweep       | used    | `micro/sweep` — header + drawer CTA, every service scene CTA, estimator "Book this shipment", hero van button                                   |
| u29 | URL input          | n/a     | no URL field on the site                                                                                                                        |
| u30 | Sticky header      | used    | `site-header.tsx` — floating rounded bar, condenses on scroll, scroll-spy accent pill (`header-nav.tsx`)                                        |
| u31 | Dashboard header   | used    | `micro/icon-button` — header menu/close; Phase 5 — dashboard mock headers                                                                       |
| u32 | Toast              | used    | `micro/toast` — "Number copied"; credited/settled events (Phase 5)                                                                              |
| u33 | Text input         | used    | `micro/text-field` — hero waybill field, hero Book tab, invite page, every form from here on                                                    |
| u34 | Stepper (progress) | used    | `micro/progress-stepper` — How it works (auto-advance, connector fills, checks); Phase 5 — consignment legs                                     |
| u35 | Tooltip card       | used    | `micro/tooltip-card` TermTip — estimator "Volumetric weight"; glossary terms from here on                                                       |

## Storytelling controls

| #   | Pattern                         | Status   | Where                                                                                                                                                   |
| --- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Parachute progress              | used     | hero quote "Calculate"; estimator "Estimate"                                                                                                            |
| 2   | Van drive-off                   | used     | invite form submit (hero Book tab and /request-invite)                                                                                                  |
| 3   | Glow field                      | gallery  | newsletter (hidden until an endpoint exists)                                                                                                            |
| 4   | Paper-plane send                | gallery  | newsletter (same)                                                                                                                                       |
| 5   | Rolling-label button            | used     | hero Track button; track band Track button (Track → Finding… then navigate)                                                                             |
| 6   | Label-into-parcel               | planned  | Phase 6 — contact form button hover                                                                                                                     |
| 7   | Expanding track field           | used     | header                                                                                                                                                  |
| 8   | Liquid bead                     | used     | hero tabs (pill), bottom bar (icon), who-we-serve tabs, coverage direction; FAQ tabs (Phase 6)                                                          |
| 9   | Contact fan                     | used     | floating contact button; bottom bar Contact                                                                                                             |
| 10  | Segmented code → link-and-merge | used     | coverage PIN / postcode checker                                                                                                                         |
| 11  | Scene switcher                  | used     | services showcase — four scenes                                                                                                                         |
| 12  | Feature vignette (beats)        | planned  | Phase 5 — platform tour                                                                                                                                 |
| 13  | Reactive mascot                 | optional | Phase 7                                                                                                                                                 |
| 14  | Door hover                      | optional | Phase 7                                                                                                                                                 |
| 15  | Supporting touches              | used     | theme morph (superseded by u14 on the chrome), chevron morph, copy tick, floating labels (superseded by u33), draw-on checkbox/toggle, validation icons |

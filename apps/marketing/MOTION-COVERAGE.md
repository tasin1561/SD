# Motion coverage — where every reference pattern lives

The 46 reference patterns (35 UI upgrades u01–u35 and 11 storytelling controls) and where
each is used on skydrop.online, or why it is not. Ideas only: our tokens, icons and copy;
transform/opacity only; no new libraries. Updated per phase; Phase 9 checks it for gaps.

Status: **used** (shipped) · **planned** (Phase named) · **n/a** (reason).

## UI upgrades

| #   | Pattern            | Status | Where                                                                                                                                                                                                 |
| --- | ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| u01 | Footer             | used   | `site-footer.tsx` — brand block, coloured circular socials, marker links that slide, newsletter card hidden until an endpoint exists, legal bar                                                       |
| u02 | Phone input        | used   | `micro/phone-field` — hero Book tab; contact form                                                                                                                                                     |
| u03 | Checkbox           | used   | `micro/touches` DrawCheckbox (+ hover halo) — invite page; the tour checklists are `vignettes/vignette-checklist` (ticks by beat)                                                                     |
| u04 | Filter bar         | used   | `micro/chip-select` (single) — "What you can send" verdict filter                                                                                                                                     |
| u05 | Select dropdown    | used   | `micro/text-field` SelectField — invite page                                                                                                                                                          |
| u06 | Chat input         | n/a    | no chat on the site (ChatWoot is a separate droplet, deferred)                                                                                                                                        |
| u07 | Data table         | used   | `micro/data-table` — Compare (swipe cards below md); the tour's stock register and store table are plain token tables (numeric, not verdict chips)                                                    |
| u08 | Switch             | used   | `micro/touches` DrawToggle with ON / OFF — estimator COD switch; tour: STRICT mode, per-consignment freight, automatic withdrawals, role permissions                                                  |
| u09 | Tabs               | used   | `micro/liquid-bead` pill — hero action card; who-we-serve; coverage direction; tour tabs; freight-mode choice in the stock-in vignette; FAQ category tabs                                             |
| u10 | Radio cards        | used   | `micro/choice-cards` — hero quote + book direction; estimator direction and parcel type; stock-in route chooser ("Straight to India" / "Via our Bangladesh warehouse")                                |
| u11 | Success popup      | used   | `micro/success-card` — hero Book tab after a real 201                                                                                                                                                 |
| u12 | Quantity stepper   | used   | `micro/stepper` — hero quote weight; estimator weight and L × W × H; "Units set aside" (Phase 5)                                                                                                      |
| u13 | Password strength  | n/a    | no password field on the marketing site                                                                                                                                                               |
| u14 | Theme switch       | used   | `micro/theme-switch` — header and drawer                                                                                                                                                              |
| u15 | Profile upload     | used   | hand-built in `vignettes/catalogue` (no micro primitive): dashed drop zone, tiles landing staggered, the four real states queued → uploading → registering → done as a travelling pill                |
| u16 | Pagination         | used   | `micro/pagination` — testimonials carousel pager (bubble travels)                                                                                                                                     |
| u17 | Order tracking     | used   | `micro/tracking-card` — hero Track tab (Sample); track band (Sample); order lifecycle mock (Phase 5)                                                                                                  |
| u18 | Cascading dropdown | used   | `micro/combo-select` — estimator state/division → city cascade                                                                                                                                        |
| u19 | Accordion          | used   | `sections/faq` — native `<details name="faq">` (exclusive), plus→minus morph, panel grows on grid-template-rows 0fr→1fr; `micro/liquid-bead` pill for the category tabs                               |
| u20 | Hamburger drawer   | used   | `site-header.tsx` drawer — icon-chip rows that stagger in, active row filled, theme switch at the bottom                                                                                              |
| u21 | Stacked list       | used   | `micro/list-row` — drawer; header mega-menus (Services, Platform); coverage lanes; Why Skydrop rows; Phase 5 team/stores mocks; contact channel rows (hotline, WhatsApp, email)                       |
| u22 | Snackbar           | used   | `micro/toast` with `action` — contact-fan copy; the stock-in vignette DRAWS a snackbar lookalike ("CN-… cancelled — 40 units returned to you", action "View") rather than firing `toast()` on a timer |
| u23 | Sidebar            | used   | the tour vignettes' frames (`vignettes/vignette-frame`) stand in for the dashboard chrome; a literal sidebar mock was dropped to keep each vignette ≤ 5 KB                                            |
| u24 | Multi-select       | used   | `micro/chip-select` (multiple) — estimator "what are you sending"; Phase 5 — store allow-list                                                                                                         |
| u25 | Contact form       | used   | `micro/text-field` + `phone-field` + `text-area` — contact form (name/email/phone/message, staged validation, 500-char counter, mailto + WhatsApp links, no submit)                                   |
| u26 | Chat UI            | n/a    | no chat on the site                                                                                                                                                                                   |
| u27 | Empty state        | used   | `micro/empty-state` — coverage "Somewhere else?" → WhatsApp; `app/not-found.tsx` ("Back to the home page" / "Track a parcel")                                                                         |
| u28 | Button sweep       | used   | `micro/sweep` — header + drawer CTA, every service scene CTA, estimator "Book this shipment", hero van button, final CTA band (`tone="ink"` on the corridor gradient), the 404's way home             |
| u29 | URL input          | n/a    | no URL field on the site                                                                                                                                                                              |
| u30 | Sticky header      | used   | `site-header.tsx` — floating rounded bar, condenses on scroll, scroll-spy accent pill (`header-nav.tsx`)                                                                                              |
| u31 | Dashboard header   | used   | `micro/icon-button` — header menu/close; Phase 5 — dashboard mock headers                                                                                                                             |
| u32 | Toast              | used   | `micro/toast` — "Number copied"; credited/settled events (Phase 5)                                                                                                                                    |
| u33 | Text input         | used   | `micro/text-field` — hero waybill field, hero Book tab, invite page, every form from here on                                                                                                          |
| u34 | Stepper (progress) | used   | `micro/progress-stepper` — How it works (auto-advance, connector fills, checks); Phase 5 — consignment legs                                                                                           |
| u35 | Tooltip card       | used   | `micro/tooltip-card` TermTip — estimator "Volumetric weight"; glossary terms from here on                                                                                                             |

## Storytelling controls

| #   | Pattern                         | Status   | Where                                                                                                                                                      |
| --- | ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Parachute progress              | used     | hero quote "Calculate"; estimator "Estimate"                                                                                                               |
| 2   | Van drive-off                   | used     | invite form submit (hero Book tab and /request-invite)                                                                                                     |
| 3   | Glow field                      | gallery  | newsletter (hidden until an endpoint exists)                                                                                                               |
| 4   | Paper-plane send                | gallery  | newsletter (same)                                                                                                                                          |
| 5   | Rolling-label button            | used     | hero Track button; track band Track button (Track → Finding… then navigate)                                                                                |
| 6   | Label-into-parcel               | used     | `micro/label-into-parcel` — contact form "Email us" button hover (the mailto opens; no busy/success state, per the honesty rule)                           |
| 7   | Expanding track field           | used     | header                                                                                                                                                     |
| 8   | Liquid bead                     | used     | hero tabs (pill), bottom bar (icon), who-we-serve tabs, coverage direction; FAQ tabs (Phase 6)                                                             |
| 9   | Contact fan                     | used     | floating contact button; bottom bar Contact                                                                                                                |
| 10  | Segmented code → link-and-merge | used     | coverage PIN / postcode checker                                                                                                                            |
| 11  | Scene switcher                  | used     | services showcase — four scenes                                                                                                                            |
| 12  | Feature vignette (beats)        | used     | `vignettes/use-beats` + `vignette-frame` — six platform-tour vignettes (stock-in, catalogue, orders, returns, money, team) and the reseller two-party demo |
| 13  | Reactive mascot                 | used     | `micro/reactive-mascot` — contact form: eyes follow the caret across the fields, beams once email + message are valid; ships only in the near-gated contact chunk                                                                                                                                                    |
| 14  | Door hover                      | n/a     | no place earned it — every link on the page is a sweep or a row; kept in the gallery                                                                                                                                                    |
| 15  | Supporting touches              | used     | theme morph (superseded by u14 on the chrome), chevron morph, copy tick, floating labels (superseded by u33), draw-on checkbox/toggle, validation icons    |

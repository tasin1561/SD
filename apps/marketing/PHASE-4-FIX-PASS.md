# Phase 4 fix pass — owner's review (2026-09-21), runs after Phase 5 merges, before Phase 6

## Accuracy (must-fix)

1. Partner strip: only Delhivery and Shiprocket were ever given. Remove Blue Dart, DTDC,
   Ekart, Xpressbees; wording like "Delhivery · Shiprocket — and the couriers in their
   networks". Audit every page: no real company name unless it is in block 3B.
2. Compare table: colour by BENEFIT TO THE READER, not literal yes/no. "Indian entity
   required": Skydrop = green check "Not needed to start"; DIY = amber/red "Required";
   Marketplace = amber "Varies". Audit every row for the same inversion.

## Visual

3. Section eyebrows are ~700 px tinted bars → compact chips (inline-flex, fit-content).
   Saffron eyebrows are brown in dark → apply the navy-mix rule to them.
4. Dark-mode scene backgrounds: "Send to India" is a brown panel. Navy-mix surface + hue
   glow for ALL scene and section tints in dark; no {hue}-900/950 fills on large areas.
   Re-render the four scenes.
5. Illustrations are small grey wireframes → colourful isometric pieces using the
   `--art-*` tokens in the section's accent (saffron plane + parcel for Send to India,
   green for Send to Bangladesh, teal for stock, magenta for selling), sized to fill the
   scene's right half, gentle float.
6. Coverage has no map → the 2.5D tilted map of Bangladesh + India (pins rise, arcs draw
   in the corridor gradient) under the PIN checker on desktop; a checked PIN highlights
   its region/pin.
7. Estimator: Estimate button aligned to the form's left edge and made the u28 sweep
   button; "Book this shipment" disabled until an estimate exists; category chips show
   real icons or a visible checkbox state (no empty squares); chip row gets an edge fade +
   scroll snap (or wraps); on ≤ 430 px the four steppers 2×2 with − / value / + spread
   across each pill.
8. How it works: two tracks under a liquid-bead toggle — "Sending a parcel" (Book →
   Pickup → Border & customs → Last-mile courier → Delivered) and "Selling in India" (the
   four seller steps). Default = the parcel track.
9. Hero map: fade its left and top edges with a mask gradient (hard rectangle at 1440
   dark).
10. Anchor offsets: every section id gets `scroll-margin-top` = floating header height +
    16 px.

## Logged to Phase 8 (PHASE-8-MUST-FIX.md items 3 and 4)

11. LCP ≤ 2.0 s, with the cause of what grew.
12. Micro library back to 40 KB, or the number and what the extra buys.

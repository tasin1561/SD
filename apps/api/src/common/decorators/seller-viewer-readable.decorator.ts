import { SetMetadata } from '@nestjs/common';

export const SELLER_VIEWER_READABLE_KEY = 'sellerViewerReadable';

/**
 * Marks a controller (or a single handler) whose READ endpoints a
 * `VIEWER` may call.
 *
 * ── WHY VIEWER NEEDS ITS OWN MARKER ──────────────────────────────────
 * Every other seller role gets reads for free: `SellerJwtGuard` lets
 * GET/HEAD/OPTIONS through for anyone, and `@SellerRoles` on a class
 * governs writes only. That is right for OPS / INVENTORY / FINANCE,
 * who are trusted with the whole company view and merely limited in
 * what they may CHANGE.
 *
 * VIEWER is not that. Before this marker existed, "read-only" meant
 * read-EVERYTHING: a VIEWER could pull the wallet ledger, the bank
 * details on the profile, the team list, API keys and the full
 * catalogue. That is the wrong shape for the role — someone given the
 * lowest-privilege account could still read the company's finances.
 *
 * So VIEWER's reads are an ALLOW-LIST, and this decorator is how a
 * controller opts in. Everything unmarked is closed to VIEWER.
 *
 * ── FAIL-CLOSED, LIKE THE REST OF THE GUARD ──────────────────────────
 * A new seller controller is invisible to VIEWER until someone adds
 * this decorator deliberately. That matches the write-side default
 * (OWNER + ADMIN when nothing is declared): forgetting an annotation
 * makes an endpoint too restrictive, never accidentally exposed.
 *
 * A handler-level `@SellerRoles(...)` that names VIEWER still wins
 * outright — it is absolute by design — so a single self-service
 * endpoint can be opened without marking its whole controller.
 */
export const SellerViewerReadable = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SELLER_VIEWER_READABLE_KEY, true);

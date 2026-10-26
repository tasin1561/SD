'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

/**
 * Fields the client asked to have taken off a form during UAT.
 *
 * ── WHY THE CODE IS STILL HERE ───────────────────────────────────────
 * The owner's rule for UAT: a thing the client asks to remove is
 * HIDDEN, never deleted. UAT opinions change weekly, and a field
 * deleted in October is a field somebody has to rebuild in November
 * from memory, including the validation and the money arithmetic
 * hanging off it. Every input still exists, still has its state, and
 * still sends what it always sent when it is shown.
 *
 * ── THE ANSWER LIVES IN THE DATABASE ─────────────────────────────────
 * It began as a literal here, because only the forms asked. Then the
 * owner asked that unhiding a field bring its CSV column back too — and
 * the CSV importer is in the API, which cannot import this package.
 * Two constants, one per side, would be two switches that drift apart
 * in silence, which is the exact failure a flag exists to prevent. So
 * `system_settings` holds it, the API reads it directly, and this
 * fetches it.
 *
 * ── IT FAILS CLOSED, AND CLOSED MEANS HIDDEN ─────────────────────────
 * Loading, offline, a failed request, no provider mounted: every one of
 * them hides the field. These are off BECAUSE the client asked for them
 * to be off, so "we do not know yet" must resolve to what the client
 * asked for — not to a field flickering into a form mid-demo while a
 * query settles.
 */

export type UatField = 'orderDeliveryFee' | 'orderDiscount' | 'orderDeclaredValue';

export type UatFieldMap = Readonly<Record<UatField, boolean>>;

/** Every field hidden — the answer whenever there is no better one. */
const ALL_HIDDEN: UatFieldMap = {
  orderDeliveryFee: false,
  orderDiscount: false,
  orderDeclaredValue: false,
};

const UatFieldsContext = createContext<UatFieldMap>(ALL_HIDDEN);

/**
 * Holds the answer. It does NOT fetch it.
 *
 * This package has no data client of its own and is not getting one for
 * this: each console already has `@skydrop/api-client` wired to its own
 * origin (FE-3), with the auth and single-flight refresh that go with
 * it. Fetching here would mean a second HTTP path through the estate,
 * and a dependency the owner never approved, to ask a question each app
 * can already ask. So the app fetches and passes the map in; this owns
 * the shape and the fail-closed default.
 *
 * `undefined` — still loading, offline, request failed — means hidden.
 */
export function UatFieldsProvider({
  value,
  children,
}: {
  readonly value: UatFieldMap | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <UatFieldsContext.Provider value={value ?? ALL_HIDDEN}>{children}</UatFieldsContext.Provider>
  );
}

/**
 * Whether a UAT-controlled field should be rendered.
 *
 * Call it at the top of a component like any other hook. With no
 * provider mounted it answers "hidden", which is why a console that has
 * not been wired yet shows the same forms it showed before.
 */
export function useUatField(field: UatField): boolean {
  return useContext(UatFieldsContext)[field];
}

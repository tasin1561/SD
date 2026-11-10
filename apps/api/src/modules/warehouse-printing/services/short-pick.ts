/**
 * The audit-log action a short pick is recorded under. Written by
 * `PickBatchService.recordShortPick`, read back (never written) by the
 * parcel activity trail — one constant so the two cannot drift apart.
 */
export const SHORT_PICK_ACTION = 'warehouse.pick.short';

/**
 * "Did this change request actually move the account number?"
 *
 * A request is built by merging the seller's patch onto their stored row,
 * so a request that changes only the branch name still carries the account
 * number — and the carried copy is the SAME CIPHERTEXT, byte for byte.
 * That makes the comparison exact and cheap: no decryption, no reliance on
 * the mask, and nothing that depends on which key version was current when
 * the row was written.
 *
 * Both readers and the approval path need this answer, and they must agree.
 * If a screen says "unchanged" while approval writes something different,
 * the seller's withdrawal destination moves without anyone having read it.
 *
 * Requests written before 2026-08-18 carry the right ciphertext but lost
 * the mask and key version on the way (`?? ''` / omitted), so a naive
 * decrypt of one returns the raw ciphertext blob and a naive approval
 * copies `keyVersion: null` onto the live row — leaving a number nothing
 * can decrypt. Treating them as "unchanged" is not a workaround for that:
 * they genuinely are unchanged, and the live triple is the only coherent
 * one available.
 */
export interface StoredAccountNumber {
  readonly stored: string | null;
  readonly masked: string | null;
  readonly keyVersion: number | null;
}

/**
 * True when the request leaves the account number exactly where it is.
 *
 * Empty counts as unchanged: a request cannot express "remove my account"
 * — clearing all six fields writes through as a removal and never reaches
 * this queue — so a blank here only ever means the field was not part of
 * the edit.
 */
export function carriesAccountForward(
  request: StoredAccountNumber,
  live: StoredAccountNumber,
): boolean {
  const req = request.stored ?? '';
  if (req === '') return true;
  return req === (live.stored ?? '');
}

/**
 * The account triple to SHOW for a request: the live one when the request
 * carries it forward, the request's own otherwise.
 */
export function accountForDisplay(
  request: StoredAccountNumber,
  live: StoredAccountNumber,
): StoredAccountNumber {
  return carriesAccountForward(request, live) ? live : request;
}

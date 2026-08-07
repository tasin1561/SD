/**
 * Recipient phone — India only, fixed dial code.
 *
 * Every Skydrop parcel is delivered inside India, so the recipient's
 * number is always +91 and the seller only ever supplies the 10 national
 * digits. The dial code is therefore CHROME, not input: it is rendered
 * beside the field and cannot be edited or deleted, which removes a
 * whole class of entry error (a seller clearing the prefix, typing 0091,
 * pasting a number with spaces).
 *
 * ── WHY THIS LIVES IN ONE FILE ───────────────────────────────────────
 * The create form and the edit form validate the same field. Twice now
 * a change to one has had to be chased into the other by hand, so the
 * rule lives here and both import it. A validator duplicated across two
 * screens is a validator that eventually disagrees with itself.
 *
 * State stays in E.164 (`+9198…`) because that is what the API takes and
 * what the customer-history lookup keys on. Only the INPUT is local.
 */

export const IN_DIAL = '+91';

/** Exactly ten digits. Nothing shorter, nothing longer, digits only. */
export const IN_LOCAL_LENGTH = 10;

/** India's numbering plan allocates only the 6, 7, 8 and 9 series to
 *  mobile. A ten-digit number starting 0-5 is not a number anyone can be
 *  called on, so accepting it means an order that reaches the call
 *  centre and dies there — the most expensive place to find out, in a
 *  business whose whole model is confirming COD by phone. */
const IN_MOBILE_FIRST_DIGIT = /^[6-9]/;

/** What the seller types, derived from stored E.164 for display.
 *
 *  A stored number that is NOT +91 (a legacy row, an admin entry, an
 *  imported BD number) is shown as its bare digits rather than being
 *  silently re-badged as Indian. It will fail `isCompleteLocal` and the
 *  operator has to correct it — visible beats quietly wrong. */
export function toLocalDigits(e164: string | null | undefined): string {
  if (!e164) return '';
  const v = e164.trim();
  if (v.startsWith(IN_DIAL)) return v.slice(IN_DIAL.length).replace(/\D/g, '');
  return v.replace(/\D/g, '');
}

/** Keystroke normaliser: digits only, capped at ten. Paste-safe — a
 *  pasted "+91 98123 45679" or "0091-98123-45679" reduces to the ten
 *  that matter rather than being rejected. */
export function sanitiseLocal(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('0091')) d = d.slice(4);
  else if (d.startsWith('91') && d.length > IN_LOCAL_LENGTH) d = d.slice(2);
  else if (d.startsWith('0') && d.length > IN_LOCAL_LENGTH) d = d.slice(1);
  return d.slice(0, IN_LOCAL_LENGTH);
}

/** The submit gate: ten digits AND a real mobile series. */
export function isCompleteLocal(local: string): boolean {
  return new RegExp(`^\\d{${IN_LOCAL_LENGTH}}$`).test(local) && IN_MOBILE_FIRST_DIGIT.test(local);
}

/** Local digits → what the API stores. */
export function toE164(local: string): string {
  return `${IN_DIAL}${local}`;
}

/** The one message both forms show, so they cannot word it differently. */
export const IN_PHONE_ERROR = `Phone must be ${IN_LOCAL_LENGTH} digits starting 6, 7, 8 or 9 (after ${IN_DIAL}).`;

import type { ValidationError } from 'class-validator';

/**
 * Which class-validator constraints mean "you did not send this".
 *
 * `@IsNotEmpty`, `@IsDefined` and `@ArrayNotEmpty` are the three ways a
 * DTO says a value is required; every other constraint describes a value
 * that IS there.
 */
const MISSING_CONSTRAINTS = new Set(['isDefined', 'isNotEmpty', 'arrayNotEmpty']);

/**
 * Turn class-validator's findings into the messages a person reads.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────
 * `stopAtFirstError: false` reports EVERY failed constraint, which is
 * right — a form should learn all of its problems at once. But on a
 * field that was not sent at all, every constraint fails, and Nest's
 * default joins them in decorator order. Decorators apply bottom-up, so
 * that order is the reverse of the source and the sentence that LEADS is
 * whichever decorator happens to sit last in the file.
 *
 * Found by probing the live API: omitting `recipientAddressLine2`
 * answered
 *
 *   "recipientAddressLine2 must be shorter than or equal to 200
 *    characters; recipientAddressLine2 (landmark) is required;
 *    recipientAddressLine2 must be a string"
 *
 * — so the message a UI puts in front of somebody, through FE-2's
 * verbatim `[CODE] message`, said the field was TOO LONG when they had
 * not sent it at all. The sentence that would have helped, the one
 * naming the landmark, was second. That is the same defect as a stale
 * error: the app stating something confidently false about what the
 * person did.
 *
 * ── THE RULE ────────────────────────────────────────────────────────
 * A MISSING value has exactly one problem — it is missing. So when a
 * field reports a missing-constraint, that is the only message kept for
 * it; its length and its type are not the caller's problem, and saying
 * otherwise is noise at best and a lie at worst. A field that WAS sent
 * keeps every complaint, because each is true of a value that exists.
 *
 * Nested errors keep their dotted path (`items.0.quantity`) through the
 * recursion, which is what tells a form which row to mark.
 */
export function validationMessages(errors: readonly ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const err of errors) {
    const path = parent === '' ? err.property : `${parent}.${err.property}`;
    const constraints = err.constraints ?? {};
    const keys = Object.keys(constraints);
    const missing = keys.filter((k) => MISSING_CONSTRAINTS.has(k));
    for (const key of missing.length > 0 ? missing : keys) {
      const text = constraints[key];
      if (text !== undefined) out.push(text);
    }
    if (err.children !== undefined && err.children.length > 0) {
      out.push(...validationMessages(err.children, path));
    }
  }
  return out;
}

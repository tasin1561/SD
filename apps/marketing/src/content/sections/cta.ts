/**
 * FINAL CTA — the closing band's words.
 *
 * The three readouts are the objections that actually stop somebody at
 * this point — how long, how much up front, what must I register — each
 * answered in six words or fewer rather than in another paragraph. They
 * are lifted from the product's own claims (`platform.howItWorksParcel`
 * "the rate is agreed before anything moves"; `platform.why` "no Indian
 * office, no Indian staff, no GST registration to begin"), so every one
 * is true by construction.
 *
 * NO FIGURE LIVES HERE, and none is a `dummy()` either. The band that
 * this replaces answered "to first dispatch" with "Under three weeks" —
 * a business commitment nobody supplied. A figure belongs in `business`,
 * wrapped, or nowhere; the answer here is words.
 *
 * The PRIMARY call is `platform.nav.cta`, read by the component, so the
 * header, the drawer, the mobile bar and this band cannot drift apart.
 */

export interface CtaReadout {
  id: string;
  /** The objection, in two or three words. */
  label: string;
  /** The answer, six words or fewer. */
  value: string;
}

export interface CtaSectionContent {
  title: string;
  /** One line under the heading. Courier-first: both directions are welcome. */
  lead: string;
  /** The quieter of the two calls — a person, not a form. */
  secondary: { href: string; label: string };
  readouts: readonly CtaReadout[];
}

export const cta: CtaSectionContent = {
  title: 'Ready to ship into India?',
  lead: 'Or into Bangladesh — the same rails run both ways. Tell us what you sell and where you are today; we read every request ourselves.',
  secondary: { href: '#contact', label: 'Talk to a person' },
  readouts: [
    { id: 'start', label: 'To first dispatch', value: 'An invite, then your first shipment' },
    { id: 'up-front', label: 'Up front', value: 'Your stock — the rate agreed first' },
    { id: 'register', label: 'To register in India', value: 'Nothing: no office, no GST' },
  ],
};

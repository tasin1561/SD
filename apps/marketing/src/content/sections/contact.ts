/**
 * SECTION — Contact. Copy only.
 *
 * Every BUSINESS fact this section shows — the hotline, the WhatsApp
 * number, the hours, the two addresses — lives in `business` in
 * `site.ts` as a `dummy()` and is read from there. Nothing in this file
 * is a figure, a promise about how fast we answer, or a place: it is the
 * words around them, which are the product's to state.
 *
 * The one line that reads like a service promise is deliberately NOT one.
 * "We reply within one working day" would be a business claim with no
 * owner-supplied value behind it, so the reassurance says what is true of
 * the product instead: a person reads every message.
 *
 * Why the form cannot submit: the site is a static export and the only
 * public endpoint is the invite lead form, which requires a company name.
 * A contact from one person has nowhere to go, so the two buttons build a
 * prefilled `mailto:` and a WhatsApp deep link from the fields and open
 * them. The note under the buttons says exactly that — a form that looks
 * like it sends and does not is the lie this avoids.
 */
export interface ContactField {
  label: string;
  helper: string;
  /** Shown once the field has been left AND holds something malformed. */
  error: string;
}

export interface ContactRowCopy {
  title: string;
  helper: string;
}

export interface ContactSectionContent {
  eyebrow: string;
  title: string;
  sub: string;
  form: {
    heading: string;
    name: ContactField;
    email: ContactField;
    phone: { label: string; helper: string };
    message: ContactField;
    /** Max characters the counter runs against. */
    messageMax: number;
    /** Under the two short fields — neither is required on its own. */
    either: string;
    reassurance: string;
    /** Under the buttons — what pressing one actually does. */
    note: string;
    emailCta: string;
    /** The word the parcel closes on (hover only — nothing is sent). */
    emailPacked: string;
    whatsappCta: string;
    /** Subject line of the composed email. */
    subject: string;
    /** Labels inside the composed message body. */
    bodyLabels: { name: string; email: string; phone: string };
    /** Stands in for an empty message so the composed mail is never blank. */
    bodyFallback: string;
  };
  channels: {
    heading: string;
    hotline: ContactRowCopy;
    whatsapp: ContactRowCopy;
    email: ContactRowCopy;
  };
  offices: {
    heading: string;
    dhaka: { title: string; meta: string };
    india: { title: string; meta: string };
  };
  /** Sits under the office block, in front of the hours from `business`. */
  hoursLabel: string;
}

export const contact: ContactSectionContent = {
  eyebrow: 'Contact',
  title: 'Talk to a person',
  sub: 'Tell us what you are sending, where it is going and how often. Write it below and it opens in your own email app or WhatsApp with the message already filled in — nothing is sent from this page.',
  form: {
    heading: 'Write us a message',
    name: {
      label: 'Your name',
      helper: 'So we know who we are replying to.',
      error: 'A couple of letters is enough.',
    },
    email: {
      label: 'Your email',
      helper: 'Where the reply should go.',
      error: 'That address looks incomplete.',
    },
    phone: {
      label: 'Phone or WhatsApp',
      helper: 'Optional — whichever you would rather we used.',
    },
    message: {
      label: 'What do you need?',
      helper: 'Where it is going, roughly what it is, and how often you would send it.',
      error: 'A sentence or two helps us answer properly.',
    },
    messageMax: 500,
    either: 'Leave an email or a number — one of the two is enough.',
    reassurance: 'A person reads every message.',
    note: 'Opens your email app or WhatsApp with the message filled in. Nothing is sent from this page.',
    emailCta: 'Email us',
    emailPacked: 'Packed',
    whatsappCta: 'WhatsApp us',
    subject: 'Skydrop enquiry',
    bodyLabels: { name: 'Name', email: 'Email', phone: 'Phone' },
    bodyFallback: 'I would like to know more about shipping with Skydrop.',
  },
  channels: {
    heading: 'Or reach us directly',
    hotline: {
      title: 'Call the hotline',
      helper: 'A person on the Bangladesh side of the corridor.',
    },
    whatsapp: {
      title: 'Message us on WhatsApp',
      helper: 'Same thread, same people, on your phone.',
    },
    email: { title: 'Write to us', helper: 'For quotes, consignments and anything in writing.' },
  },
  offices: {
    heading: 'Where we are',
    dhaka: { title: 'Dhaka office', meta: 'Bangladesh' },
    india: { title: 'Indian warehouse', meta: 'India' },
  },
  hoursLabel: 'Open',
};

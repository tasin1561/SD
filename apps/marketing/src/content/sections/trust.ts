/**
 * SECTION — Credentials & trust. Copy only.
 *
 * Two halves, and they are governed by DIFFERENT rules, which is the
 * whole reason they sit in one file.
 *
 * The BADGES are business facts nobody here can know: which licence,
 * which membership, which registered entity. Every one of those strings
 * is a `dummy()`, one per fact — never a whole badge wrapped in one — so
 * `scripts/check-content.mjs` lists each on its own line and the owner
 * replaces them one at a time. The wording deliberately reads as a
 * placeholder (a category, no number, no authority named): a badge that
 * invents a registration number is a forgery, and a badge that quietly
 * omits one while looking finished is the lie this file exists to avoid.
 *
 * The ASSURANCES are the opposite. Each is a thing the system does on
 * every parcel, and each is quoted from ONE bullet of `platform.claims`
 * in `site.ts` — the owner's verbatim capability list. Nothing here may
 * claim more than those bullets say, so there is no `dummy()` in this
 * half and none may appear: a placeholder would mean we were promising
 * something with no product behind it. No figure appears either — not a
 * rate, a fee or a transit time; those are `business` values.
 *
 * Row order is the parcel's own order — confirmed, tracked, returned,
 * paid — rather than the order the four capabilities happen to be
 * grouped in upstream. A reader follows a parcel, not a menu.
 */
import { dummy, type Placeholder } from '@/content/dummy';

export type TrustHue = 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta';

export type TrustBadgeIcon = 'licence' | 'association' | 'entity';

export type TrustAssuranceIcon = 'call' | 'scan' | 'inspect' | 'wallet';

export interface TrustBadge {
  /** Stable React key — ours, so it never moves when the owner edits the name. */
  id: string;
  /** What the credential is called. The OWNER's fact — placeholder until supplied. */
  name: Placeholder<string>;
  /** One line saying what it is. Also the owner's. */
  line: Placeholder<string>;
  icon: TrustBadgeIcon;
  hue: TrustHue;
}

export interface TrustAssurance {
  id: string;
  /** The thing itself, in five or six words. */
  title: string;
  /** One line, quoting the substance of its `platform.claims` bullet. */
  line: string;
  icon: TrustAssuranceIcon;
  hue: TrustHue;
}

export interface TrustSectionContent {
  eyebrow: string;
  title: string;
  sub: string;
  badges: { heading: string; items: TrustBadge[] };
  assurances: { heading: string; items: TrustAssurance[] };
}

export const trust: TrustSectionContent = {
  eyebrow: 'Credentials',
  title: 'Who you are handing your stock to',
  sub: 'The registrations we trade under on one side; on the other, four things the system does on every parcel.',
  badges: {
    heading: 'Registered and licensed',
    items: [
      {
        id: 'licence',
        name: dummy('Trade licence — Dhaka'),
        line: dummy('Registered to trade in Bangladesh.'),
        icon: 'licence',
        hue: 'green',
      },
      {
        id: 'association',
        name: dummy('Courier association member'),
        line: dummy('Membership of the national courier body.'),
        icon: 'association',
        hue: 'teal',
      },
      {
        id: 'entity',
        name: dummy('GST-registered Indian entity'),
        line: dummy('The company that holds the Indian warehouse.'),
        icon: 'entity',
        hue: 'saffron',
      },
    ],
  },
  assurances: {
    heading: 'On every parcel',
    items: [
      {
        id: 'confirmed',
        title: 'Confirmed by phone first',
        line: 'Our call centre confirms every COD order by phone before it ships, and you see each attempt and its outcome.',
        icon: 'call',
        hue: 'saffron',
      },
      {
        id: 'tracked',
        title: 'Tracked from the courier’s own scans',
        line: 'Every scan the courier sends lands on the tracking page your customer opens, and on the order you are looking at.',
        icon: 'scan',
        hue: 'blue',
      },
      {
        id: 'inspected',
        title: 'Every returned unit inspected',
        line: 'A return is judged unit by unit — restock, keep aside damaged, or write off — and what was decided is recorded.',
        icon: 'inspect',
        hue: 'magenta',
      },
      {
        id: 'credited',
        title: 'COD credited to your wallet',
        line: 'What the courier collects is credited to your wallet, itemised charge by charge, and paid out when you ask.',
        icon: 'wallet',
        hue: 'green',
      },
    ],
  },
};
